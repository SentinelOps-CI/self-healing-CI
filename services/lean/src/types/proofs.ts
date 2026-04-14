import { z } from 'zod';

/**
 * Theorem definition schema
 */
export const TheoremSchema = z.object({
  name: z.string(),
  statement: z.string(),
  proof: z.string(),
  status: z.enum(['proven', 'unproven', 'sorry', 'error']),
  confidence: z.number().min(0).max(1),
  executionTime: z.number(),
  error: z.string().optional(),
  tactics: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
});

export type Theorem = z.infer<typeof TheoremSchema>;

/**
 * Invariant definition schema
 */
export const InvariantSchema = z.object({
  name: z.string(),
  description: z.string(),
  predicate: z.string(),
  scope: z.enum(['function', 'class', 'module', 'global']),
  criticality: z.enum(['low', 'medium', 'high', 'critical']),
  theorems: z.array(TheoremSchema).default([]),
});

export type Invariant = z.infer<typeof InvariantSchema>;

/**
 * Proof validation request schema
 */
export const ProofValidationRequestSchema = z.object({
  repository: z.string(),
  headSha: z.string(),
  branch: z.string(),
  installationId: z.number(),
  invariants: z.array(InvariantSchema),
  timeout: z.number().default(2000), // 2 seconds per theorem
  maxTheorems: z.number().default(100),
});

export type ProofValidationRequest = z.infer<
  typeof ProofValidationRequestSchema
>;

/**
 * Proof validation result schema
 */
export const ProofValidationResultSchema = z.object({
  success: z.boolean(),
  validatedTheorems: z.array(TheoremSchema),
  failedTheorems: z.array(TheoremSchema),
  totalDuration: z.number(),
  error: z.string().optional(),
  summary: z.object({
    total: z.number(),
    proven: z.number(),
    unproven: z.number(),
    sorry: z.number(),
    error: z.number(),
  }),
});

export type ProofValidationResult = z.infer<typeof ProofValidationResultSchema>;

/**
 * Lean proof generation request schema
 */
export const ProofGenerationRequestSchema = z.object({
  invariant: InvariantSchema,
  context: z.string(),
  previousAttempts: z.array(z.string()).default([]),
  maxAttempts: z.number().default(3),
  timeout: z.number().default(5000), // 5 seconds
});

export type ProofGenerationRequest = z.infer<
  typeof ProofGenerationRequestSchema
>;

/**
 * Lean proof generation result schema
 */
export const ProofGenerationResultSchema = z.object({
  success: z.boolean(),
  theorem: TheoremSchema.optional(),
  proofAttempts: z.array(
    z.object({
      attempt: z.number(),
      proof: z.string(),
      status: z.enum(['success', 'timeout', 'error']),
      duration: z.number(),
      error: z.string().optional(),
    })
  ),
  error: z.string().optional(),
});

export type ProofGenerationResult = z.infer<typeof ProofGenerationResultSchema>;

/**
 * Boundary specification schema
 */
export const BoundarySpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  invariants: z.array(InvariantSchema),
  theorems: z.array(TheoremSchema),
  validationRules: z.object({
    maxExecutionTime: z.number().default(2000),
    requireProofs: z.boolean().default(true),
    allowSorry: z.boolean().default(false),
    criticalityThreshold: z
      .enum(['low', 'medium', 'high', 'critical'])
      .default('medium'),
  }),
});

export type BoundarySpec = z.infer<typeof BoundarySpecSchema>;

/**
 * Lean file template
 */
export interface LeanFileTemplate {
  imports: string[];
  definitions: string[];
  theorems: string[];
  main: string;
}

/**
 * Default Lean file template
 */
export const DEFAULT_LEAN_TEMPLATE: LeanFileTemplate = {
  imports: [
    'import Mathlib.Data.Nat.Basic',
    'import Mathlib.Data.List.Basic',
    'import Mathlib.Logic.Basic',
    'import Mathlib.Tactic.Basic',
  ],
  definitions: [],
  theorems: [],
  main: `
-- Main execution block
#eval "Proof validation completed"
`,
};

/**
 * Common Lean tactics for proof generation
 */
export const LEAN_TACTICS = {
  BASIC: ['simp', 'rw', 'apply', 'exact', 'intro', 'cases', 'induction'],
  ADVANCED: ['linarith', 'aesop', 'omega', 'ring', 'norm_num', 'decide'],
  AUTOMATION: ['auto', 'tidy', 'solve_by_elim', 'tauto'],
  SPECIALIZED: ['norm_cast', 'abel', 'ring_nf', 'field_simp'],
} as const;

/**
 * Proof generation strategies
 */
export enum ProofStrategy {
  SIMPLE = 'simple', // Basic tactics only
  ADVANCED = 'advanced', // Include advanced tactics
  AUTOMATION = 'automation', // Heavy automation
  INTERACTIVE = 'interactive', // Manual proof construction
}

/**
 * Invariant categories
 */
export const INVARIANT_CATEGORIES = {
  ORDERING: 'ordering',
  EQUALITY: 'equality',
  BOUNDS: 'bounds',
  TYPES: 'types',
  LOGIC: 'logic',
  ALGEBRAIC: 'algebraic',
} as const;

/**
 * Default invariants for common patterns
 */
export const DEFAULT_INVARIANTS: Invariant[] = [
  {
    name: 'function_preserves_ordering',
    description: 'Function preserves ordering of elements',
    predicate: '∀ (f : α → β) (xs : List α), sorted xs → sorted (map f xs)',
    scope: 'function',
    criticality: 'high',
    theorems: [],
  },
  {
    name: 'list_length_preserved',
    description: 'List length is preserved by pure functions',
    predicate: '∀ (f : α → β) (xs : List α), length (map f xs) = length xs',
    scope: 'function',
    criticality: 'medium',
    theorems: [],
  },
  {
    name: 'option_safety',
    description: 'Option operations are safe',
    predicate: '∀ (x : Option α), isSome x ∨ isNone x',
    scope: 'module',
    criticality: 'high',
    theorems: [],
  },
  {
    name: 'array_bounds',
    description: 'Array access is within bounds',
    predicate: '∀ (arr : Array α) (i : Nat), i < arr.size → valid_index arr i',
    scope: 'function',
    criticality: 'critical',
    theorems: [],
  },
];

/**
 * Proof validation configuration
 */
export interface ProofValidationConfig {
  leanPath: string;
  lakePath: string;
  timeout: number;
  maxMemory: string;
  parallelExecution: boolean;
  maxParallelTheorems: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Default proof validation configuration
 */
export const DEFAULT_PROOF_VALIDATION_CONFIG: ProofValidationConfig = {
  leanPath: 'lean',
  lakePath: 'lake',
  timeout: 2000, // 2 seconds
  maxMemory: '512m',
  parallelExecution: true,
  maxParallelTheorems: 4,
  logLevel: 'info',
};
