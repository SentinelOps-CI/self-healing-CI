import { log } from '@temporalio/activity';
import {
  createInstallationOctokit,
  parseRepository,
} from '../services/installation-octokit.js';
import { updateWorkflowState } from '../services/workflow-state-store.js';
import { logger } from '../utils/logger.js';
import { WorkflowState } from '../workflows/self-healing-workflow.js';

export interface UpdateWorkflowStatusInput {
  workflowId: string;
  state: WorkflowState;
  timestamp: string;
  data?: Record<string, unknown>;
  repository?: string;
  commitSha?: string;
  installationId?: number;
}

export interface UpdateWorkflowStatusResult {
  success: boolean;
  error?: string;
}

function githubStatusForWorkflowState(
  state: WorkflowState
): 'pending' | 'success' | 'failure' | 'error' {
  if (state === WorkflowState.DONE) {
    return 'success';
  }
  if (state === WorkflowState.FAILED) {
    return 'failure';
  }
  return 'pending';
}

/**
 * Activity: persist state and optionally post a GitHub commit status.
 */
export async function updateWorkflowStatus(
  input: UpdateWorkflowStatusInput
): Promise<UpdateWorkflowStatusResult> {
  const startTime = Date.now();
  const activityId = log.info('Updating workflow status', {
    workflowId: input.workflowId,
    state: input.state,
  });

  try {
    await updateWorkflowState({
      workflowId: input.workflowId,
      state: input.state,
      timestamp: input.timestamp,
      data: input.data,
    });

    if (input.repository && input.commitSha && input.installationId) {
      const installationId = input.installationId;
      if (installationId > 0) {
        const octokit = await createInstallationOctokit(installationId);
        const { owner, repo } = parseRepository(input.repository);
        await octokit.rest.repos.createCommitStatus({
          owner,
          repo,
          sha: input.commitSha,
          state: githubStatusForWorkflowState(input.state),
          context: 'self-healing-ci/workflow',
          description: `Self-healing: ${input.state}`,
        });
      }
    }

    logger.info('Workflow status updated', {
      activityId,
      workflowId: input.workflowId,
      state: input.state,
      duration: Date.now() - startTime,
    });

    return { success: true };
  } catch (error) {
    logger.error('Workflow status update failed', {
      activityId,
      workflowId: input.workflowId,
      state: input.state,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
