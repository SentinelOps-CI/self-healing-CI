import { z } from 'zod';

/**
 * Patch application request schema
 */
export const PatchRequestSchema = z.object({
  repository: z.string(),
  headSha: z.string(),
  branch: z.string(),
  patch: z.string(),
  rootCause: z.enum([
    'DEP_UPGRADE',
    'API_CHANGE',
    'FLAKY_TEST',
    'CONFIG_ERROR',
    'ENV_ISSUE',
    'PERMISSION_ERROR',
    'TIMEOUT',
    'UNKNOWN',
  ]),
  installationId: z.number(),
  maxRetries: z.number().default(2),
});

export type PatchRequest = z.infer<typeof PatchRequestSchema>;

/**
 * Patch application result schema
 */
export const PatchResultSchema = z.object({
  success: z.boolean(),
  patchSha: z.string().optional(),
  filesChanged: z.array(z.string()).default([]),
  compilationErrors: z.array(z.string()).default([]),
  validationErrors: z.array(z.string()).default([]),
  error: z.string().optional(),
  duration: z.number(),
  retryCount: z.number().default(0),
  /** When compilation fails, workflows may re-run diagnosis using these diagnostics instead of a blind retry. */
  orchestratorHint: z.string().optional(),
});

export type PatchResult = z.infer<typeof PatchResultSchema>;

/**
 * Compilation validation result
 */
export const CompilationResultSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  duration: z.number(),
  language: z.enum(['typescript', 'rust', 'javascript', 'python', 'unknown']),
});

export type CompilationResult = z.infer<typeof CompilationResultSchema>;

/**
 * File change information
 */
export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  linesAdded: number;
  linesDeleted: number;
  content?: string;
}

/**
 * Patch metadata
 */
export interface PatchMetadata {
  id: string;
  timestamp: string;
  rootCause: string;
  confidence: number;
  explanation: string;
  estimatedFixTime?: number;
  suggestedActions?: string[];
}

/**
 * Morph API response schema
 */
export const MorphApiResponseSchema = z.object({
  success: z.boolean(),
  patchId: z.string().optional(),
  changes: z
    .array(
      z.object({
        file: z.string(),
        content: z.string(),
        operation: z.enum(['create', 'update', 'delete']),
      })
    )
    .default([]),
  error: z.string().optional(),
  metadata: z
    .object({
      model: z.string(),
      tokensUsed: z.number(),
      duration: z.number(),
    })
    .optional(),
});

export type MorphApiResponse = z.infer<typeof MorphApiResponseSchema>;

/**
 * Patch validation context
 */
export interface PatchValidationContext {
  repository: string;
  headSha: string;
  branch: string;
  installationId: number;
  patch: string;
  rootCause: string;
  compilationErrors?: string[];
  previousAttempts?: number;
}

/**
 * Compilation validator interface
 */
export interface CompilationValidator {
  validate(workspacePath: string): Promise<CompilationResult>;
  getLanguage(): string;
  getCompilationCommand(): string[];
  getErrorPatterns(): RegExp[];
}

/**
 * Patch application strategy
 */
export enum PatchStrategy {
  DIRECT = 'direct', // Apply patch directly
  BRANCH = 'branch', // Create new branch
  PR = 'pull_request', // Create pull request
  COMMIT = 'commit', // Commit directly
}

/**
 * Patch safety level
 */
export enum PatchSafetyLevel {
  SAFE = 'safe', // Low risk, can auto-merge
  MEDIUM = 'medium', // Medium risk, requires review
  HIGH = 'high', // High risk, manual review required
  DANGEROUS = 'dangerous', // Very high risk, manual intervention
}

/**
 * Patch validation rules
 */
export interface PatchValidationRules {
  maxFileChanges: number;
  maxLinesChanged: number;
  allowedFileTypes: string[];
  forbiddenPatterns: RegExp[];
  requireTests: boolean;
  requireDocumentation: boolean;
  safetyThresholds: Record<PatchSafetyLevel, number>;
}

/**
 * Default validation rules
 */
export const DEFAULT_VALIDATION_RULES: PatchValidationRules = {
  maxFileChanges: 10,
  maxLinesChanged: 1000,
  allowedFileTypes: [
    '.ts',
    '.js',
    '.tsx',
    '.jsx',
    '.json',
    '.md',
    '.yml',
    '.yaml',
    '.rs',
    '.py',
    '.go',
    '.java',
    '.cpp',
    '.c',
    '.h',
    '.hpp',
  ],
  forbiddenPatterns: [
    /TODO|FIXME|HACK|XXX/i,
    /console\.log|debugger|alert\(/i,
    /password|secret|token|key/i,
    /eval\(|Function\(|setTimeout\(|setInterval\(/i,
  ],
  requireTests: true,
  requireDocumentation: false,
  safetyThresholds: {
    [PatchSafetyLevel.SAFE]: 0.1,
    [PatchSafetyLevel.MEDIUM]: 0.3,
    [PatchSafetyLevel.HIGH]: 0.7,
    [PatchSafetyLevel.DANGEROUS]: 1.0,
  },
};
