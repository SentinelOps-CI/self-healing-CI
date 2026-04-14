import { log } from '@temporalio/activity';
import { getSelfHealingEnv } from '../config/self-healing-env.js';
import {
  createInstallationOctokit,
  parseRepository,
} from '../services/installation-octokit.js';
import { logger } from '../utils/logger.js';

export interface MergeChangesInput {
  repository: string;
  installationId: number;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
}

export interface MergeChangesResult {
  success: boolean;
  merged?: boolean;
  skipped?: boolean;
  mergeCommitSha?: string;
  prNumber?: number;
  branchDeleted?: boolean;
  error?: string;
}

/**
 * Merge the self-healing PR when SELF_HEALING_AUTO_MERGE=true.
 */
export async function mergeChanges(
  input: MergeChangesInput
): Promise<MergeChangesResult> {
  const startTime = Date.now();
  const activityId = log.info('Merging changes', {
    repository: input.repository,
    headBranch: input.headBranch,
  });

  const env = getSelfHealingEnv();

  if (!env.autoMerge) {
    logger.info('Auto-merge disabled; skipping merge', { activityId });
    return {
      success: true,
      skipped: true,
      merged: false,
    };
  }

  try {
    const octokit = await createInstallationOctokit(input.installationId);
    const { owner, repo } = parseRepository(input.repository);

    const open = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${input.headBranch}`,
      per_page: 5,
    });

    const pr = open.data[0];
    if (!pr) {
      return {
        success: false,
        error: `No open pull request for head ${input.headBranch}`,
      };
    }

    const merge = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: pr.number,
      merge_method: 'squash',
      commit_title: input.title,
      commit_message: input.body,
    });

    logger.info('Pull request merged', {
      activityId,
      pr: pr.number,
      duration: Date.now() - startTime,
    });

    return {
      success: merge.data.merged === true,
      merged: merge.data.merged === true,
      mergeCommitSha: merge.data.sha || undefined,
      prNumber: pr.number,
      branchDeleted: false,
    };
  } catch (error) {
    logger.error('Merge failed', {
      activityId,
      repository: input.repository,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
