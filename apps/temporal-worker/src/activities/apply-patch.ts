import { log } from '@temporalio/activity';
import axios from 'axios';
import { getSelfHealingEnv } from '../config/self-healing-env.js';
import { applyUnifiedDiffOnGitHub } from '../services/github-healing-patch.js';
import { logger } from '../utils/logger.js';
import { RootCause } from '../workflows/self-healing-workflow.js';

export interface ApplyPatchInput {
  repository: string;
  headSha: string;
  branch: string;
  patch: string;
  rootCause: RootCause;
  installationId: number;
  workflowRunId: number;
}

export interface ApplyPatchResult {
  success: boolean;
  patchSha?: string;
  filesChanged?: string[];
  error?: string;
}

/**
 * Activity to apply patches (Morph HTTP API when configured, otherwise GitHub branch + PR).
 */
export async function applyPatch(
  input: ApplyPatchInput
): Promise<ApplyPatchResult> {
  const startTime = Date.now();
  const activityId = log.info('Applying patch', {
    repository: input.repository,
    headSha: input.headSha,
    branch: input.branch,
    rootCause: input.rootCause,
  });

  const env = getSelfHealingEnv();

  try {
    if (env.dryRun) {
      logger.info('Dry run: skipping patch application', { activityId });
      return { success: true, patchSha: 'dry-run' };
    }

    if (!input.patch?.trim()) {
      return { success: false, error: 'Empty patch' };
    }

    if (env.patchBackend === 'morph' && process.env['MORPH_API_KEY']) {
      const apiUrl = process.env['MORPH_API_URL'] || 'https://api.morph.dev';
      try {
        const res = await axios.post<{
          patchSha?: string;
          filesChanged?: string[];
        }>(
          `${apiUrl.replace(/\/$/, '')}/apply`,
          {
            repository: input.repository,
            headSha: input.headSha,
            branch: input.branch,
            patch: input.patch,
            rootCause: input.rootCause,
            installationId: input.installationId,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env['MORPH_API_KEY']}`,
              'Content-Type': 'application/json',
            },
            timeout: 120_000,
            validateStatus: () => true,
          }
        );
        if (res.status >= 200 && res.status < 300) {
          return {
            success: true,
            patchSha: res.data.patchSha,
            filesChanged: res.data.filesChanged,
          };
        }
        return {
          success: false,
          error: `Morph API HTTP ${res.status}`,
        };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Morph request failed',
        };
      }
    }

    const healingBranch = `self-healing-ci/${input.workflowRunId}-${input.headSha.substring(0, 7)}`;

    const gh = await applyUnifiedDiffOnGitHub({
      repository: input.repository,
      installationId: input.installationId,
      baseBranch: input.branch,
      healingBranch,
      headSha: input.headSha,
      unifiedDiff: input.patch,
      workflowRunId: input.workflowRunId,
    });

    if (!gh.success) {
      return { success: false, error: gh.error || 'GitHub patch failed' };
    }

    logger.info('Patch applied successfully', {
      activityId,
      repository: input.repository,
      patchSha: gh.patchSha,
      filesChanged: gh.filesChanged,
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      patchSha: gh.patchSha,
      filesChanged: gh.filesChanged,
    };
  } catch (error) {
    logger.error('Patch application failed', {
      activityId,
      repository: input.repository,
      headSha: input.headSha,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
