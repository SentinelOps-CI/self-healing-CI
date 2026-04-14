import axios from 'axios';
import { execa } from 'execa';
import { simpleGit, SimpleGit } from 'simple-git';
import { logger } from './logger.js';
import {
  CompilationResult,
  CompilationValidator,
  DEFAULT_VALIDATION_RULES,
  PatchRequest,
  PatchResult,
  PatchSafetyLevel,
} from './types/patch.js';
import { JavaScriptValidator } from './validators/javascript-validator.js';
import { RustValidator } from './validators/rust-validator.js';
import { TypeScriptValidator } from './validators/typescript-validator.js';

export interface MorphClientOptions {
  apiKey: string;
  apiUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  validationRules?: typeof DEFAULT_VALIDATION_RULES;
}

export class MorphClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly validationRules: typeof DEFAULT_VALIDATION_RULES;
  private readonly validators: Map<string, CompilationValidator>;

  constructor(options: MorphClientOptions) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl;
    this.timeoutMs = options.timeoutMs || 30000;
    this.maxRetries = options.maxRetries || 2;
    this.validationRules = options.validationRules || DEFAULT_VALIDATION_RULES;

    // Initialize validators
    this.validators = new Map([
      ['typescript', new TypeScriptValidator()],
      ['rust', new RustValidator()],
      ['javascript', new JavaScriptValidator()],
    ]);
  }

  /**
   * Apply patch with compilation validation
   */
  async applyPatch(request: PatchRequest): Promise<PatchResult> {
    const startTime = Date.now();
    const patchId = `morph-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    logger.info('Applying patch with Morph', {
      patchId,
      repository: request.repository,
      headSha: request.headSha,
      rootCause: request.rootCause,
      maxRetries: request.maxRetries,
    });

    try {
      // Validate patch before application
      const validationResult = await this.validatePatch(request);
      if (!validationResult.success) {
        return {
          success: false,
          validationErrors: validationResult.errors,
          duration: Date.now() - startTime,
          retryCount: 0,
        };
      }

      // Apply patch using Morph API
      const morphResult = await this.applyPatchWithMorph(request, patchId);
      if (!morphResult.success) {
        return {
          success: false,
          error: morphResult.error,
          duration: Date.now() - startTime,
          retryCount: 0,
        };
      }

      // Validate compilation after patch
      const compilationResult = await this.validateCompilation(request);

      if (!compilationResult.success) {
        // If compilation fails, retry with compiler diagnostics
        return await this.handleCompilationFailure(
          request,
          compilationResult,
          startTime
        );
      }

      // Patch applied successfully
      logger.info('Patch applied successfully', {
        patchId,
        filesChanged: morphResult.changes.length,
        compilationSuccess: compilationResult.success,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        patchSha: morphResult.patchId,
        filesChanged: morphResult.changes.map(c => c.file),
        duration: Date.now() - startTime,
        retryCount: 0,
      };
    } catch (error) {
      logger.error('Patch application failed', {
        patchId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
        retryCount: 0,
      };
    }
  }

  /**
   * Apply patch using Morph API
   */
  private async applyPatchWithMorph(
    request: PatchRequest,
    patchId: string
  ): Promise<{
    success: boolean;
    patchId?: string;
    changes: Array<{ file: string; content: string; operation: string }>;
    error?: string;
  }> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/apply-patch`,
        {
          patchId,
          repository: request.repository,
          headSha: request.headSha,
          branch: request.branch,
          patch: request.patch,
          rootCause: request.rootCause,
          installationId: request.installationId,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        }
      );

      return {
        success: true,
        patchId: response.data.patchId,
        changes: response.data.changes || [],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          success: false,
          error: error.response?.data?.error || error.message,
          changes: [],
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        changes: [],
      };
    }
  }

  /**
   * Validate patch before application
   */
  private async validatePatch(request: PatchRequest): Promise<{
    success: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Check patch format
    if (!this.isValidPatchFormat(request.patch)) {
      errors.push('Invalid patch format');
    }

    // Check file changes count
    const fileChanges = this.parsePatchFiles(request.patch);
    if (fileChanges.length > this.validationRules.maxFileChanges) {
      errors.push(
        `Too many files changed: ${fileChanges.length} > ${this.validationRules.maxFileChanges}`
      );
    }

    // Check lines changed
    const linesChanged = this.countLinesChanged(request.patch);
    if (linesChanged > this.validationRules.maxLinesChanged) {
      errors.push(
        `Too many lines changed: ${linesChanged} > ${this.validationRules.maxLinesChanged}`
      );
    }

    // Check file types
    for (const file of fileChanges) {
      const fileExt = this.getFileExtension(file);
      if (!this.validationRules.allowedFileTypes.includes(fileExt)) {
        errors.push(`File type not allowed: ${fileExt}`);
      }
    }

    // Check for forbidden patterns
    for (const pattern of this.validationRules.forbiddenPatterns) {
      if (pattern.test(request.patch)) {
        errors.push(`Forbidden pattern found in patch: ${pattern.source}`);
      }
    }

    // Check safety level
    const safetyLevel = this.assessPatchSafety(request);
    if (safetyLevel === PatchSafetyLevel.DANGEROUS) {
      errors.push('Patch safety level is DANGEROUS - manual review required');
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate compilation after patch
   */
  private async validateCompilation(
    request: PatchRequest
  ): Promise<CompilationResult> {
    const workspacePath = `/tmp/morph-workspace-${Date.now()}`;

    try {
      // Clone repository to temporary workspace
      await this.cloneRepository(
        request.repository,
        request.headSha,
        workspacePath
      );

      // Apply patch to workspace
      await this.applyPatchToWorkspace(request.patch, workspacePath);

      // Detect primary language and validate
      const primaryLanguage = await this.detectPrimaryLanguage(workspacePath);
      const validator = this.validators.get(primaryLanguage);

      if (!validator) {
        return {
          success: true, // No validator available, assume success
          errors: [],
          warnings: [`No validator available for language: ${primaryLanguage}`],
          duration: 0,
          language: 'unknown',
        };
      }

      return await validator.validate(workspacePath);
    } catch (error) {
      return {
        success: false,
        errors: [
          error instanceof Error ? error.message : 'Unknown compilation error',
        ],
        duration: 0,
        language: 'unknown',
      };
    } finally {
      // Cleanup workspace
      await this.cleanupWorkspace(workspacePath);
    }
  }

  /**
   * Handle compilation failure with retry logic
   */
  private async handleCompilationFailure(
    request: PatchRequest,
    compilationResult: CompilationResult,
    startTime: number
  ): Promise<PatchResult> {
    logger.warn('Compilation failed after patch', {
      repository: request.repository,
      errors: compilationResult.errors,
      language: compilationResult.language,
    });

    const previousAttempts =
      (request as { previousAttempts?: number }).previousAttempts ?? 0;
    const hint =
      'Compilation failed after applying the patch. Re-run diagnosis with the compilationErrors field so the model can propose a corrected diff. Automatic Morph-side retries require orchestration (Claude loop), not a silent re-apply of the same patch.';

    logger.info('Compilation failure recorded for orchestrator', {
      repository: request.repository,
      remainingMorphRetries: request.maxRetries,
      previousAttempts,
      compilationErrors: compilationResult.errors,
    });

    return {
      success: false,
      filesChanged: [],
      compilationErrors: compilationResult.errors,
      validationErrors: [],
      duration: Date.now() - startTime,
      retryCount: previousAttempts,
      orchestratorHint: hint,
      error: compilationResult.errors[0] ?? 'Compilation failed after patch',
    };
  }

  /**
   * Assess patch safety level
   */
  private assessPatchSafety(request: PatchRequest): PatchSafetyLevel {
    let riskScore = 0;

    // Risk factors
    if (request.rootCause === 'API_CHANGE') riskScore += 0.3;
    if (request.rootCause === 'DEP_UPGRADE') riskScore += 0.2;
    if (request.rootCause === 'CONFIG_ERROR') riskScore += 0.1;

    const linesChanged = this.countLinesChanged(request.patch);
    if (linesChanged > 100) riskScore += 0.2;
    if (linesChanged > 500) riskScore += 0.3;

    const fileChanges = this.parsePatchFiles(request.patch);
    if (fileChanges.length > 5) riskScore += 0.2;
    if (
      fileChanges.some(
        f => f.includes('package.json') || f.includes('Cargo.toml')
      )
    )
      riskScore += 0.3;

    // Determine safety level
    if (
      riskScore <= this.validationRules.safetyThresholds[PatchSafetyLevel.SAFE]
    ) {
      return PatchSafetyLevel.SAFE;
    } else if (
      riskScore <=
      this.validationRules.safetyThresholds[PatchSafetyLevel.MEDIUM]
    ) {
      return PatchSafetyLevel.MEDIUM;
    } else if (
      riskScore <= this.validationRules.safetyThresholds[PatchSafetyLevel.HIGH]
    ) {
      return PatchSafetyLevel.HIGH;
    } else {
      return PatchSafetyLevel.DANGEROUS;
    }
  }

  /**
   * Utility methods
   */
  private isValidPatchFormat(patch: string): boolean {
    // Basic unified diff format validation
    const lines = patch.split('\n');
    return lines.some(
      line =>
        line.startsWith('diff --git') ||
        line.startsWith('---') ||
        line.startsWith('+++')
    );
  }

  private parsePatchFiles(patch: string): string[] {
    const files: string[] = [];
    const lines = patch.split('\n');

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          files.push(match[1]);
        }
      }
    }

    return [...new Set(files)]; // Remove duplicates
  }

  private countLinesChanged(patch: string): number {
    let linesChanged = 0;
    const lines = patch.split('\n');

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) linesChanged++;
      if (line.startsWith('-') && !line.startsWith('---')) linesChanged++;
    }

    return linesChanged;
  }

  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot > 0 ? filename.substring(lastDot) : '';
  }

  private async cloneRepository(
    repository: string,
    sha: string,
    workspacePath: string
  ): Promise<void> {
    const git: SimpleGit = simpleGit();
    await git.clone(repository, workspacePath);
    await git.cwd(workspacePath);
    await git.checkout(sha);
  }

  private async applyPatchToWorkspace(
    patch: string,
    workspacePath: string
  ): Promise<void> {
    const { stderr } = await execa('git', ['apply'], {
      cwd: workspacePath,
      input: patch,
    });

    if (stderr) {
      throw new Error(`Failed to apply patch: ${stderr}`);
    }
  }

  private async detectPrimaryLanguage(workspacePath: string): Promise<string> {
    // Simple language detection based on file presence
    const { stdout } = await execa(
      'find',
      [
        workspacePath,
        '-name',
        '*.ts',
        '-o',
        '-name',
        '*.js',
        '-o',
        '-name',
        '*.rs',
        '-o',
        '-name',
        '*.py',
      ],
      {
        cwd: workspacePath,
      }
    );

    const files = stdout.split('\n').filter(Boolean);
    const extensions = files.map(f => this.getFileExtension(f));

    if (extensions.some(ext => ext === '.ts' || ext === '.tsx'))
      return 'typescript';
    if (extensions.some(ext => ext === '.rs')) return 'rust';
    if (extensions.some(ext => ext === '.js' || ext === '.jsx'))
      return 'javascript';
    if (extensions.some(ext => ext === '.py')) return 'python';

    return 'unknown';
  }

  private async cleanupWorkspace(workspacePath: string): Promise<void> {
    try {
      await execa('rm', ['-rf', workspacePath]);
    } catch (error) {
      logger.warn('Failed to cleanup workspace', { workspacePath, error });
    }
  }
}
