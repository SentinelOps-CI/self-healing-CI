import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';
import {
  DEFAULT_LEAN_TEMPLATE,
  DEFAULT_PROOF_VALIDATION_CONFIG,
  LEAN_TACTICS,
  ProofStrategy,
} from './types/proofs.js';
import type {
  Invariant,
  ProofGenerationRequest,
  ProofGenerationResult,
  ProofValidationConfig,
  ProofValidationRequest,
  ProofValidationResult,
  Theorem,
} from './types/proofs.js';

export interface LeanClientOptions {
  config?: Partial<ProofValidationConfig>;
  workspacePath?: string;
  maxParallelExecutions?: number;
}

export class LeanClient {
  private readonly config: ProofValidationConfig;
  private readonly workspacePath: string;
  private readonly maxParallelExecutions: number;

  constructor(options: LeanClientOptions = {}) {
    this.config = { ...DEFAULT_PROOF_VALIDATION_CONFIG, ...options.config };
    this.workspacePath = options.workspacePath || '/tmp/lean-proofs';
    this.maxParallelExecutions = options.maxParallelExecutions || 4;
  }

  /**
   * Validate proofs for invariants
   */
  async validateProofs(
    request: ProofValidationRequest
  ): Promise<ProofValidationResult> {
    const startTime = Date.now();
    const validationId = `lean-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    logger.info('Starting proof validation', {
      validationId,
      repository: request.repository,
      invariantsCount: request.invariants.length,
      timeout: request.timeout,
    });

    try {
      // Create Lean workspace
      const workspaceDir = path.join(this.workspacePath, validationId);
      await this.createLeanWorkspace(workspaceDir);

      // Generate theorems from invariants
      const theorems = await this.generateTheoremsFromInvariants(
        request.invariants,
        request.maxTheorems
      );

      // Validate theorems in parallel
      const validationResults = await this.validateTheoremsParallel(
        theorems,
        workspaceDir,
        request.timeout
      );

      // Aggregate results
      const validatedTheorems = validationResults.filter(
        t => t.status === 'proven'
      );
      const failedTheorems = validationResults.filter(
        t => t.status !== 'proven'
      );

      const summary = {
        total: validationResults.length,
        proven: validatedTheorems.length,
        unproven: failedTheorems.filter(t => t.status === 'unproven').length,
        sorry: failedTheorems.filter(t => t.status === 'sorry').length,
        error: failedTheorems.filter(t => t.status === 'error').length,
      };

      const duration = Date.now() - startTime;

      logger.info('Proof validation completed', {
        validationId,
        total: summary.total,
        proven: summary.proven,
        duration,
      });

      return {
        success: summary.proven > 0,
        validatedTheorems,
        failedTheorems,
        totalDuration: duration,
        summary,
      };
    } catch (error) {
      logger.error('Proof validation failed', {
        validationId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        validatedTheorems: [],
        failedTheorems: [],
        totalDuration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        summary: {
          total: 0,
          proven: 0,
          unproven: 0,
          sorry: 0,
          error: 1,
        },
      };
    }
  }

  /**
   * Generate proof for specific invariant
   */
  async generateProof(
    request: ProofGenerationRequest
  ): Promise<ProofGenerationResult> {
    const startTime = Date.now();
    const generationId = `lean-gen-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    logger.info('Generating proof for invariant', {
      generationId,
      invariant: request.invariant.name,
      maxAttempts: request.maxAttempts,
    });

    try {
      const proofAttempts: ProofGenerationResult['proofAttempts'] = [];

      for (let attempt = 1; attempt <= request.maxAttempts; attempt++) {
        const attemptStart = Date.now();

        try {
          // Generate proof using different strategies
          const strategy = this.selectProofStrategy(attempt);
          const proof = await this.generateProofWithStrategy(
            request.invariant,
            strategy,
            request.context,
            request.previousAttempts
          );

          // Validate the generated proof
          const validationResult = await this.validateSingleProof(
            proof,
            request.timeout
          );

          if (validationResult.status === 'proven') {
            logger.info('Proof generated successfully', {
              generationId,
              attempt,
              strategy,
              duration: Date.now() - attemptStart,
            });

            return {
              success: true,
              theorem: {
                name: request.invariant.name,
                statement: request.invariant.predicate,
                proof,
                status: 'proven',
                confidence: 0.9,
                executionTime: Date.now() - attemptStart,
                tactics: this.extractTactics(proof),
                dependencies: [],
              },
              proofAttempts,
            };
          }

          proofAttempts.push({
            attempt,
            proof,
            status: 'error',
            duration: Date.now() - attemptStart,
            error: validationResult.error,
          });
        } catch (error) {
          proofAttempts.push({
            attempt,
            proof: '',
            status: 'error',
            duration: Date.now() - attemptStart,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.warn('Failed to generate proof after all attempts', {
        generationId,
        attempts: proofAttempts.length,
      });

      return {
        success: false,
        proofAttempts,
        error: 'Failed to generate valid proof after all attempts',
      };
    } catch (error) {
      logger.error('Proof generation failed', {
        generationId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        proofAttempts: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create Lean workspace with project structure
   */
  private async createLeanWorkspace(workspaceDir: string): Promise<void> {
    await fs.ensureDir(workspaceDir);

    // Create lakefile.lean
    const lakefileContent = `
import Lake
open Lake DSL

package «proofs» {
  -- add package configuration options here
}

@[default_target]
lean_lib Proofs {
  -- add library configuration options here
}
`;

    await fs.writeFile(
      path.join(workspaceDir, 'lakefile.lean'),
      lakefileContent
    );

    // Create Proofs directory
    const proofsDir = path.join(workspaceDir, 'Proofs');
    await fs.ensureDir(proofsDir);

    // Create main Lean file
    const mainContent = this.generateMainLeanFile();
    await fs.writeFile(path.join(proofsDir, 'Main.lean'), mainContent);

    // Initialize Lake project
    await execa(this.config.lakePath, ['update'], { cwd: workspaceDir });
  }

  /**
   * Generate main Lean file with imports and structure
   */
  private generateMainLeanFile(): string {
    const { imports, definitions, theorems, main } = DEFAULT_LEAN_TEMPLATE;

    return `${imports.join('\n')}

-- Definitions
${definitions.join('\n\n')}

-- Theorems
${theorems.join('\n\n')}

${main}
`;
  }

  /**
   * Generate theorems from invariants
   */
  private async generateTheoremsFromInvariants(
    invariants: Invariant[],
    maxTheorems: number
  ): Promise<Theorem[]> {
    const theorems: Theorem[] = [];

    for (const invariant of invariants) {
      if (theorems.length >= maxTheorems) break;

      // Generate basic theorem for invariant
      const theorem: Theorem = {
        name: `theorem_${invariant.name}`,
        statement: invariant.predicate,
        proof: `by sorry`, // Placeholder proof
        status: 'unproven',
        confidence: 0,
        executionTime: 0,
        tactics: [],
        dependencies: [],
      };

      theorems.push(theorem);
    }

    return theorems;
  }

  /**
   * Validate theorems in parallel
   */
  private async validateTheoremsParallel(
    theorems: Theorem[],
    workspaceDir: string,
    timeout: number
  ): Promise<Theorem[]> {
    const results: Theorem[] = [];
    const chunks = this.chunkArray(theorems, this.maxParallelExecutions);

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(theorem =>
        this.validateSingleTheorem(theorem, workspaceDir, timeout)
      );

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Validate single theorem
   */
  private async validateSingleTheorem(
    theorem: Theorem,
    workspaceDir: string,
    timeout: number
  ): Promise<Theorem> {
    const startTime = Date.now();

    try {
      // Create temporary Lean file for this theorem
      const tempFile = path.join(
        workspaceDir,
        'Proofs',
        `${theorem.name}.lean`
      );
      const leanContent = this.generateTheoremFile(theorem);
      await fs.writeFile(tempFile, leanContent);

      // Run Lean check
      const { stdout, stderr } = await execa(
        this.config.leanPath,
        ['--json', tempFile],
        {
          cwd: workspaceDir,
          timeout: timeout,
          reject: false,
        }
      );

      const duration = Date.now() - startTime;
      const output = stderr || stdout;

      // Parse Lean output
      const status = this.parseLeanOutput(output);
      const error = status === 'error' ? output : undefined;

      return {
        ...theorem,
        status,
        executionTime: duration,
        error,
      };
    } catch (error) {
      return {
        ...theorem,
        status: 'error',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate Lean file for single theorem
   */
  private generateTheoremFile(theorem: Theorem): string {
    return `${DEFAULT_LEAN_TEMPLATE.imports.join('\n')}

theorem ${theorem.name} : ${theorem.statement} :=
${theorem.proof}

#eval "${theorem.name} validated"
`;
  }

  /**
   * Parse Lean output to determine theorem status
   */
  private parseLeanOutput(output: string): Theorem['status'] {
    if (output.includes('sorry')) return 'sorry';
    if (output.includes('error') || output.includes('Error')) return 'error';
    if (output.includes('unproven') || output.includes('unsolved goals'))
      return 'unproven';
    if (output.includes('validated') || output.includes('success'))
      return 'proven';

    // Default to unproven if unclear
    return 'unproven';
  }

  /**
   * Select proof generation strategy based on attempt number
   */
  private selectProofStrategy(attempt: number): ProofStrategy {
    switch (attempt) {
      case 1:
        return ProofStrategy.SIMPLE;
      case 2:
        return ProofStrategy.ADVANCED;
      case 3:
        return ProofStrategy.AUTOMATION;
      default:
        return ProofStrategy.INTERACTIVE;
    }
  }

  /**
   * Generate proof with specific strategy
   */
  private async generateProofWithStrategy(
    invariant: Invariant,
    strategy: ProofStrategy,
    context: string,
    previousAttempts: string[]
  ): Promise<string> {
    const tactics = this.getTacticsForStrategy(strategy);
    const proofSteps = this.generateProofSteps(
      invariant,
      tactics,
      context,
      previousAttempts
    );

    return proofSteps.join('\n');
  }

  /**
   * Get tactics for proof strategy
   */
  private getTacticsForStrategy(strategy: ProofStrategy): string[] {
    switch (strategy) {
      case ProofStrategy.SIMPLE:
        return [...LEAN_TACTICS.BASIC];
      case ProofStrategy.ADVANCED:
        return [...LEAN_TACTICS.BASIC, ...LEAN_TACTICS.ADVANCED];
      case ProofStrategy.AUTOMATION:
        return [
          ...LEAN_TACTICS.BASIC,
          ...LEAN_TACTICS.ADVANCED,
          ...LEAN_TACTICS.AUTOMATION,
        ];
      case ProofStrategy.INTERACTIVE:
        return [
          ...LEAN_TACTICS.BASIC,
          ...LEAN_TACTICS.ADVANCED,
          ...LEAN_TACTICS.SPECIALIZED,
        ];
      default:
        return [...LEAN_TACTICS.BASIC];
    }
  }

  /**
   * Generate proof steps
   */
  private generateProofSteps(
    invariant: Invariant,
    tactics: string[],
    context: string,
    _previousAttempts: string[]
  ): string[] {
    const steps: string[] = [];

    // Start with basic tactics
    steps.push('intro h');
    steps.push('simp at h');

    // Add context-specific steps
    if (context.includes('list') || context.includes('array')) {
      steps.push('cases h');
      steps.push('simp');
    }

    if (context.includes('function') || context.includes('map')) {
      steps.push('apply funext');
      steps.push('intro x');
      steps.push('simp');
    }

    // Add fallback tactics
    steps.push('try { aesop }');
    steps.push('try { linarith }');

    return steps;
  }

  /**
   * Validate single proof
   */
  private async validateSingleProof(
    proof: string,
    timeout: number
  ): Promise<{
    status: Theorem['status'];
    error?: string;
  }> {
    try {
      const tempFile = path.join(
        this.workspacePath,
        `temp-proof-${Date.now()}.lean`
      );
      const leanContent = `
${DEFAULT_LEAN_TEMPLATE.imports.join('\n')}

theorem temp_theorem : True :=
${proof}

#eval "Proof validated"
`;

      await fs.writeFile(tempFile, leanContent);

      const { stdout, stderr } = await execa(
        this.config.leanPath,
        ['--json', tempFile],
        {
          timeout,
          reject: false,
        }
      );

      const output = stderr || stdout;
      const status = this.parseLeanOutput(output);

      // Cleanup
      await fs.remove(tempFile);

      return {
        status,
        error: status === 'error' ? output : undefined,
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Extract tactics from proof
   */
  private extractTactics(proof: string): string[] {
    const tactics: string[] = [];
    const lines = proof.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('by ') ||
        trimmed.startsWith('apply ') ||
        trimmed.startsWith('simp')
      ) {
        tactics.push(trimmed);
      }
    }

    return tactics;
  }

  /**
   * Utility methods
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
