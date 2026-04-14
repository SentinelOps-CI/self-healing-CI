import axios from 'axios';
import type {
  TestExecutionRequest,
  TestExecutionResult,
} from '@self-healing-ci/freestyle';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const execAsync = promisify(execCb);

export interface RunTestsParams {
  repository: string;
  headSha: string;
  branch: string;
  testCommand: string;
  timeoutMs: number;
}

export interface RunTestsOutcome {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

function getExecutionMode(): string {
  return (
    process.env['SELF_HEALING_TEST_EXECUTION_MODE']?.trim().toLowerCase() ||
    'auto'
  );
}

const FreestyleHttpResponseSchema = z.object({
  success: z.boolean(),
  output: z.string().optional(),
  error: z.string().optional(),
  duration: z.number().optional(),
});

async function runViaFreestyleHttp(
  params: RunTestsParams,
  baseUrl: string,
  apiKey: string
): Promise<RunTestsOutcome> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/test-runs`;
  const started = Date.now();
  try {
    const res = await axios.post<unknown>(
      url,
      {
        repository: params.repository,
        headSha: params.headSha,
        branch: params.branch,
        testCommand: params.testCommand,
        timeoutMs: params.timeoutMs,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: params.timeoutMs + 15_000,
        validateStatus: () => true,
      }
    );

    if (res.status < 200 || res.status >= 300) {
      const snippet =
        typeof res.data === 'object' && res.data !== null
          ? JSON.stringify(res.data).slice(0, 400)
          : String(res.data).slice(0, 400);
      return {
        success: false,
        error: `Freestyle API HTTP ${res.status}: ${snippet}`,
        duration: Date.now() - started,
      };
    }

    const parsed = FreestyleHttpResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      logger.warn('Unexpected Freestyle API response shape', {
        issues: parsed.error.flatten(),
      });
      return {
        success: false,
        error: 'Freestyle API returned an unexpected JSON body',
        duration: Date.now() - started,
      };
    }

    const d = parsed.data;
    return {
      success: d.success,
      output: d.output,
      error: d.error,
      duration: d.duration ?? Date.now() - started,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Freestyle HTTP request failed',
      duration: Date.now() - started,
    };
  }
}

function buildFreestyleDockerRequest(
  params: RunTestsParams,
  hostWorkspace: string
): TestExecutionRequest {
  const containerPath =
    process.env['FREESTYLE_CONTAINER_WORKSPACE']?.trim() || '/workspace';
  const installationId = parseInt(
    process.env['SELF_HEALING_INSTALLATION_ID'] || '0',
    10
  );
  const retryCount = parseInt(process.env['FREESTYLE_RETRY_COUNT'] || '2', 10);

  return {
    repository: params.repository,
    headSha: params.headSha,
    branch: params.branch,
    testSuite: 'custom',
    customShellCommand: params.testCommand,
    installationId,
    retryCount,
    containerConfig: {
      image: process.env['FREESTYLE_DOCKER_IMAGE']?.trim() || 'node',
      tag: process.env['FREESTYLE_DOCKER_TAG']?.trim() || '20-bookworm',
      environment: {},
      volumes: [
        {
          host: hostWorkspace,
          container: containerPath,
          mode: 'rw',
        },
      ],
      ports: [],
      command: [],
      workingDir:
        process.env['FREESTYLE_CONTAINER_WORKDIR']?.trim() || containerPath,
      timeout: params.timeoutMs,
      memory: process.env['FREESTYLE_DOCKER_MEMORY']?.trim() || '512m',
      cpu: process.env['FREESTYLE_DOCKER_CPU']?.trim() || '1.0',
    },
  };
}

function mapFreestyleDockerResult(r: TestExecutionResult): RunTestsOutcome {
  const lines = [
    r.executionTrace,
    ...r.testResults.map(t =>
      `${t.name}: ${t.output || ''} ${t.error || ''}`.trim()
    ),
  ].filter(Boolean);
  return {
    success: r.success,
    output: lines.join('\n') || undefined,
    error: r.error,
    duration: r.duration,
  };
}

async function runViaFreestyleDocker(
  params: RunTestsParams,
  hostWorkspace: string
): Promise<RunTestsOutcome> {
  const started = Date.now();
  try {
    const { FreestyleClient } = await import('@self-healing-ci/freestyle');
    const socket =
      process.env['FREESTYLE_DOCKER_SOCKET']?.trim() ||
      process.env['DOCKER_HOST']?.trim();
    const client = new FreestyleClient({
      ...(socket ? { dockerSocket: socket } : {}),
      defaultTimeout: params.timeoutMs,
      maxRetries: parseInt(process.env['FREESTYLE_RETRY_COUNT'] || '3', 10),
    });
    const request = buildFreestyleDockerRequest(params, hostWorkspace);
    const result = await client.executeTests(request);
    return mapFreestyleDockerResult(result);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Freestyle Docker run failed',
      duration: Date.now() - started,
    };
  }
}

async function runViaLocalShell(
  params: RunTestsParams,
  workdir: string
): Promise<RunTestsOutcome> {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execAsync(params.testCommand, {
      cwd: workdir,
      timeout: params.timeoutMs,
      env: {
        ...process.env,
        CI: 'true',
        SELF_HEALING_REPOSITORY: params.repository,
        GITHUB_SHA: params.headSha,
        GITHUB_REF: `refs/heads/${params.branch}`,
      },
      windowsHide: true,
    });
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    return {
      success: true,
      output: combined,
      duration: Date.now() - started,
    };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    const combined = [err.stdout, err.stderr].filter(Boolean).join('\n');
    const nonZero = typeof err.code === 'number' && err.code !== 0;
    return {
      success: false,
      output: combined || undefined,
      error:
        err.message ||
        combined ||
        (nonZero ? `exit ${err.code}` : 'Local test execution failed'),
      duration: Date.now() - started,
    };
  }
}

/**
 * Run tests: remote HTTP (`/v1/test-runs`), Freestyle Docker (`@self-healing-ci/freestyle`), or local shell.
 *
 * Modes: `disabled` | `http` | `docker` | `local` | `auto` (HTTP if configured, else Docker when `FREESTYLE_USE_DOCKER=true`, else local shell if `SELF_HEALING_TEST_WORKDIR` is set).
 */
export async function executeTests(
  params: RunTestsParams
): Promise<RunTestsOutcome> {
  const mode = getExecutionMode();
  const baseUrl = process.env['FREESTYLE_API_URL']?.trim();
  const apiKey = process.env['FREESTYLE_API_KEY']?.trim();
  const workdir = process.env['SELF_HEALING_TEST_WORKDIR']?.trim();
  const hostForDocker =
    process.env['FREESTYLE_HOST_WORKSPACE']?.trim() || workdir;
  const httpReady = Boolean(baseUrl && apiKey);
  const useDockerFlag = process.env['FREESTYLE_USE_DOCKER'] === 'true';

  if (mode === 'disabled') {
    return {
      success: false,
      error:
        'Test execution disabled (SELF_HEALING_TEST_EXECUTION_MODE=disabled)',
      duration: 0,
    };
  }

  if (mode === 'http') {
    if (!baseUrl || !apiKey) {
      return {
        success: false,
        error:
          'HTTP test mode requires FREESTYLE_API_URL and FREESTYLE_API_KEY',
        duration: 0,
      };
    }
    return runViaFreestyleHttp(params, baseUrl, apiKey);
  }

  if (mode === 'docker') {
    if (!hostForDocker) {
      return {
        success: false,
        error:
          'Docker test mode requires FREESTYLE_HOST_WORKSPACE or SELF_HEALING_TEST_WORKDIR (host path to mount)',
        duration: 0,
      };
    }
    return runViaFreestyleDocker(params, hostForDocker);
  }

  if (mode === 'local') {
    if (!workdir) {
      return {
        success: false,
        error:
          'Local test mode requires SELF_HEALING_TEST_WORKDIR (absolute path to a checkout)',
        duration: 0,
      };
    }
    return runViaLocalShell(params, workdir);
  }

  if (mode === 'auto') {
    if (httpReady) {
      return runViaFreestyleHttp(params, baseUrl!, apiKey!);
    }
    if (useDockerFlag && hostForDocker) {
      return runViaFreestyleDocker(params, hostForDocker);
    }
    if (workdir) {
      return runViaLocalShell(params, workdir);
    }
    return {
      success: false,
      error:
        'No test backend available in auto mode. Configure FREESTYLE_API_URL + FREESTYLE_API_KEY, or set FREESTYLE_USE_DOCKER=true with a host workspace path, or set SELF_HEALING_TEST_WORKDIR for local shell.',
      duration: 0,
    };
  }

  return {
    success: false,
    error: `Unknown SELF_HEALING_TEST_EXECUTION_MODE: ${mode}`,
    duration: 0,
  };
}
