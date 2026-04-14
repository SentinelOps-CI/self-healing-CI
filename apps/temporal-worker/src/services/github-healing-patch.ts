import { applyPatch } from 'diff';
import parseDiff from 'parse-diff';
import {
  createInstallationOctokit,
  parseRepository,
} from './installation-octokit.js';
import { logger } from '../utils/logger.js';

export interface GitHubPatchApplyInput {
  repository: string;
  installationId: number;
  baseBranch: string;
  healingBranch: string;
  headSha: string;
  unifiedDiff: string;
  workflowRunId: number;
}

export interface GitHubPatchApplyResult {
  success: boolean;
  patchSha?: string;
  filesChanged?: string[];
  prNumber?: number;
  error?: string;
}

function decodeContent(data: { content?: string; encoding?: string }): string {
  if (!data.content) {
    return '';
  }
  if (data.encoding === 'base64') {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(
      'utf8'
    );
  }
  return data.content;
}

function extractSingleFileDiff(fullDiff: string, filePath: string): string {
  const needle = `diff --git a/${filePath} b/${filePath}`;
  const idx = fullDiff.indexOf(needle);
  if (idx < 0) {
    return '';
  }
  const rest = fullDiff.slice(idx);
  const next = rest.indexOf('\ndiff --git ', 1);
  return next > 0 ? rest.slice(0, next).trim() : rest.trim();
}

function filePathFromParseDiff(file: { to?: string; from?: string }): string {
  const p = file.to || file.from || '';
  return p.replace(/^[ab]\//, '');
}

/**
 * Apply a unified diff on a new branch and ensure an open PR exists.
 */
export async function applyUnifiedDiffOnGitHub(
  input: GitHubPatchApplyInput
): Promise<GitHubPatchApplyResult> {
  const { owner, repo } = parseRepository(input.repository);
  const octokit = await createInstallationOctokit(input.installationId);

  const files = parseDiff(input.unifiedDiff);
  if (files.length === 0) {
    return { success: false, error: 'No parseable files in unified diff' };
  }

  try {
    await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${input.healingBranch}`,
    });
  } catch {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${input.healingBranch}`,
      sha: input.headSha,
    });
  }

  const changed: string[] = [];

  for (const file of files) {
    const path = filePathFromParseDiff(file);
    if (!path) {
      continue;
    }

    const fileDiff = extractSingleFileDiff(input.unifiedDiff, path);
    if (!fileDiff) {
      logger.warn('Skipping file with no diff block', { path });
      continue;
    }

    let current = '';
    try {
      const existing = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: input.healingBranch,
      });
      if (!Array.isArray(existing.data) && existing.data.type === 'file') {
        current = decodeContent(existing.data);
      }
    } catch {
      current = '';
    }

    const nextContent = applyPatch(current, fileDiff);
    if (nextContent === false) {
      return {
        success: false,
        error: `Could not apply unified diff to ${path}`,
      };
    }

    let sha: string | undefined;
    try {
      const cur = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: input.healingBranch,
      });
      if (!Array.isArray(cur.data) && 'sha' in cur.data) {
        sha = cur.data.sha;
      }
    } catch {
      sha = undefined;
    }

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `chore(self-healing): update ${path}`,
      content: Buffer.from(nextContent, 'utf8').toString('base64'),
      branch: input.healingBranch,
      sha,
    });

    changed.push(path);
  }

  const branch = await octokit.rest.repos.getBranch({
    owner,
    repo,
    branch: input.healingBranch,
  });
  const tipSha = branch.data.commit.sha;

  const prNumber = await ensurePullRequest(octokit, {
    owner,
    repo,
    head: input.healingBranch,
    base: input.baseBranch,
    title: `fix(ci): self-healing run ${input.workflowRunId}`,
    body: `Automated patch from Self-Healing CI.\n\n- Workflow run: ${input.workflowRunId}\n- Base: \`${input.baseBranch}\`\n- Head: \`${input.healingBranch}\``,
  });

  return {
    success: true,
    patchSha: tipSha,
    filesChanged: changed,
    prNumber,
  };
}

async function ensurePullRequest(
  octokit: Awaited<ReturnType<typeof createInstallationOctokit>>,
  opts: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }
): Promise<number | undefined> {
  const existing = await octokit.rest.pulls.list({
    owner: opts.owner,
    repo: opts.repo,
    state: 'open',
    head: `${opts.owner}:${opts.head}`,
    per_page: 10,
  });

  if (existing.data.length > 0) {
    return existing.data[0]?.number;
  }

  const created = await octokit.rest.pulls.create({
    owner: opts.owner,
    repo: opts.repo,
    title: opts.title,
    head: opts.head,
    base: opts.base,
    body: opts.body,
  });
  return created.data.number;
}
