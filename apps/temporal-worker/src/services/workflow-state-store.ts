import { getSharedRedis } from './redis-client.js';
import { logger } from '../utils/logger.js';
import { WorkflowState } from '../workflows/self-healing-workflow.js';

export interface WorkflowStateData {
  workflowId: string;
  state: WorkflowState;
  timestamp: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface WorkflowStateResult {
  stateId: string;
  success: boolean;
}

/**
 * Persist workflow state transitions to Redis (optional).
 */
export async function updateWorkflowState(
  input: WorkflowStateData
): Promise<WorkflowStateResult> {
  const startTime = Date.now();
  const stateId = `state_${input.workflowId}_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 11)}`;

  try {
    const redis = getSharedRedis();
    const payload = JSON.stringify({
      ...input,
      stateId,
      savedAt: new Date().toISOString(),
    });

    if (redis) {
      await redis.set(
        `workflow_state:${input.workflowId}`,
        payload,
        'EX',
        86400 * 7
      );
    }

    logger.info('Workflow state persisted', {
      stateId,
      workflowId: input.workflowId,
      state: input.state,
      duration: Date.now() - startTime,
    });

    return {
      stateId,
      success: true,
    };
  } catch (error) {
    logger.error('Failed to update workflow state', {
      stateId,
      workflowId: input.workflowId,
      state: input.state,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    });

    return {
      stateId,
      success: false,
    };
  }
}
