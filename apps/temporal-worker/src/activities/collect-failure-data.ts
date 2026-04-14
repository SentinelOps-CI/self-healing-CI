import { log } from '@temporalio/activity';
import { collectFailureLogs } from '../services/failure-collector.js';
import type { FailureData } from '../types/failure-data.js';
import { logger } from '../utils/logger.js';

export interface CollectFailureDataInput {
  repository: string;
  workflowRunId: number;
  headSha: string;
  branch: string;
  installationId: number;
}

export interface CollectFailureDataResult {
  failureData: FailureData;
}

/**
 * Activity: fetch logs and git context from GitHub for diagnosis.
 */
export async function collectFailureData(
  input: CollectFailureDataInput
): Promise<CollectFailureDataResult> {
  const activityId = log.info('collectFailureData', {
    repository: input.repository,
    workflowRunId: input.workflowRunId,
  });

  try {
    const failureData = await collectFailureLogs(input);
    logger.info('collectFailureData completed', {
      activityId,
      repository: input.repository,
    });
    return { failureData };
  } catch (error) {
    logger.error('collectFailureData failed', {
      activityId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
