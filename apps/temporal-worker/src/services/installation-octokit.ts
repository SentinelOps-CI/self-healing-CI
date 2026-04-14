import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';

const octokitCache = new Map<number, Octokit>();

function getAppCredentials(): { appId: string; privateKey: string } {
  const appId = process.env['GITHUB_APP_ID'] || '';
  const privateKey =
    process.env['GITHUB_PRIVATE_KEY'] ||
    process.env['GITHUB_APP_PRIVATE_KEY'] ||
    '';
  if (!appId || !privateKey) {
    throw new Error(
      'Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY / GITHUB_APP_PRIVATE_KEY'
    );
  }
  return { appId, privateKey };
}

/**
 * Octokit client authenticated as a GitHub App installation.
 */
export async function createInstallationOctokit(
  installationId: number
): Promise<Octokit> {
  const cached = octokitCache.get(installationId);
  if (cached) {
    return cached;
  }

  const { appId, privateKey } = getAppCredentials();
  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  });

  const { token } = await auth({ type: 'installation', installationId });
  const octokit = new Octokit({ auth: token });

  octokitCache.set(installationId, octokit);
  logger.debug('Created installation Octokit client', { installationId });
  return octokit;
}

export function parseRepository(fullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository full name: ${fullName}`);
  }
  return { owner, repo };
}
