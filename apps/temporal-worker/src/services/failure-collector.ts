import JSZip from 'jszip';
import type { FailureData } from '../types/failure-data.js';
import { logger } from '../utils/logger.js';
import {
  createInstallationOctokit,
  parseRepository,
} from './installation-octokit.js';

export interface CollectFailureLogsInput {
  repository: string;
  workflowRunId: number;
  headSha: string;
  branch: string;
  installationId: number;
}

const MAX_LOG_CHARS = 400_000;

/**
 * Collect workflow failure context from the GitHub API (jobs, logs summary, compare).
 */
export async function collectFailureLogs(
  input: CollectFailureLogsInput
): Promise<FailureData> {
  const startTime = Date.now();
  const { owner, repo } = parseRepository(input.repository);
  const octokit = await createInstallationOctokit(input.installationId);

  const { data: run } = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: input.workflowRunId,
  });

  const jobs = await octokit.paginate(
    octokit.rest.actions.listJobsForWorkflowRun,
    {
      owner,
      repo,
      run_id: input.workflowRunId,
      per_page: 100,
    }
  );

  const failedJobSummaries: string[] = [];
  let buildLogs = `Workflow: ${run.name || 'unknown'}\nConclusion: ${run.conclusion}\nHTML: ${run.html_url}\n\n`;

  for (const job of jobs) {
    if (job.conclusion !== 'failure' && job.conclusion !== 'cancelled') {
      continue;
    }
    let jobSection = `## Job: ${job.name} (${job.conclusion})\n`;
    for (const step of job.steps || []) {
      if (step.conclusion === 'failure') {
        jobSection += `  - failed step: ${step.name}\n`;
      }
    }
    try {
      const logText = await downloadJobLogsZipText(
        octokit,
        owner,
        repo,
        job.id
      );
      if (logText) {
        jobSection += `\n### Log excerpt\n${logText}\n`;
      }
    } catch (e) {
      logger.warn('Could not download job logs', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    failedJobSummaries.push(jobSection);
  }

  buildLogs += failedJobSummaries.join('\n');
  if (buildLogs.length > MAX_LOG_CHARS) {
    buildLogs = `${buildLogs.slice(0, MAX_LOG_CHARS)}\n...[truncated]`;
  }

  const runExt = run as typeof run & { before?: string | null };
  const baseSha = runExt.before || input.headSha;
  const changedFiles: string[] = [];

  try {
    const compare = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseSha}...${input.headSha}`,
    });
    for (const f of compare.data.files || []) {
      changedFiles.push(f.filename);
    }
  } catch (e) {
    logger.warn('compareCommits failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  let commitMessage = '';
  let author = '';
  try {
    const c = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: input.headSha,
    });
    commitMessage = c.data.commit.message || '';
    author = c.data.commit.author?.name || '';
  } catch {
    commitMessage = '';
    author = '';
  }

  const duration =
    run.run_started_at && run.updated_at
      ? new Date(run.updated_at).getTime() -
        new Date(run.run_started_at).getTime()
      : 0;

  logger.info('Failure context collected', {
    repository: input.repository,
    workflowRunId: input.workflowRunId,
    durationMs: Date.now() - startTime,
    logChars: buildLogs.length,
  });

  return {
    buildLogs,
    baseSha,
    changedFiles,
    commitMessage,
    author,
    duration,
    failedTests: [],
    runner: run.name || '',
    os: '',
    nodeVersion: '',
    dependencies: {},
    environment: {},
    memoryUsage: 0,
    cpuUsage: 0,
    networkRequests: 0,
  };
}

async function downloadJobLogsZipText(
  octokit: Awaited<ReturnType<typeof createInstallationOctokit>>,
  owner: string,
  repo: string,
  jobId: number
): Promise<string> {
  const response = await octokit.request({
    method: 'GET',
    url: 'GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs',
    owner,
    repo,
    job_id: jobId,
    request: { redirect: 'manual' },
  });

  if (response.status !== 302 && response.status !== 301) {
    return '';
  }

  const location = response.headers.location;
  if (!location) {
    return '';
  }

  const logRes = await fetch(location);
  if (!logRes.ok) {
    return '';
  }

  const buf = Buffer.from(await logRes.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);
  const parts: string[] = [];

  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir && (name.endsWith('.txt') || name.includes('/'))) {
      const content = await file.async('string');
      parts.push(`### ${name}\n${content}`);
    }
  }

  let text = parts.join('\n\n');
  if (text.length > 200_000) {
    text = `${text.slice(0, 200_000)}\n...[truncated]`;
  }
  return text;
}
