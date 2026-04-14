import { log } from '@temporalio/activity';
import { validateProofs as runProofValidation } from '../services/lean-proof-client.js';
import { logger } from '../utils/logger.js';

export interface ValidateProofsInput {
  repository: string;
  headSha: string;
  branch: string;
  proofFiles?: string[];
}

export interface ValidateProofsOutput {
  success: boolean;
  validatedProofs: number;
  totalProofs: number;
  errors: string[];
  error: string | undefined;
}

/**
 * Activity to validate formal proofs using Lean 4
 */
export async function validateProofs(
  input: ValidateProofsInput
): Promise<ValidateProofsOutput> {
  const startTime = Date.now();
  const activityId = log.info('Validating proofs', {
    repository: input.repository,
    headSha: input.headSha,
    branch: input.branch,
    proofFiles: input.proofFiles,
  });

  try {
    const proofFiles = input.proofFiles ?? [];

    const validationResult = await runProofValidation({
      repository: input.repository,
      headSha: input.headSha,
      branch: input.branch,
      proofFiles,
    });

    logger.info('Proof validation completed', {
      activityId,
      repository: input.repository,
      success: validationResult.success,
      validatedProofs: validationResult.validatedProofs,
      totalProofs: validationResult.totalProofs,
      duration: Date.now() - startTime,
    });

    return {
      success: validationResult.success,
      validatedProofs: validationResult.validatedProofs,
      totalProofs: validationResult.totalProofs,
      errors: validationResult.errors,
      error: validationResult.error,
    };
  } catch (error) {
    logger.error('Proof validation failed', {
      activityId,
      repository: input.repository,
      headSha: input.headSha,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      validatedProofs: 0,
      totalProofs: (input.proofFiles ?? []).length,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
