import { log } from '@temporalio/activity';
import { executeTests } from '../services/test-execution.js';
import { logger } from '../utils/logger.js';

export interface RunTestsInput {
  repository: string;
  headSha: string;
  branch: string;
  /** Defaults to SELF_HEALING_TEST_COMMAND or `pnpm test`. */
  testCommand?: string;
  timeoutMs?: number;
}

export interface RunTestsResult {
  success: boolean;
  output: string | undefined;
  error: string | undefined;
  duration: number;
  retryDiagnosis: boolean | undefined;
}

/**
 * Activity to run tests using Freestyle container
 */
export async function runTests(input: RunTestsInput): Promise<RunTestsResult> {
  const startTime = Date.now();
  const timeoutMs =
    input.timeoutMs ??
    parseInt(process.env['SELF_HEALING_TEST_TIMEOUT_MS'] || '600000', 10);
  const testCommand =
    input.testCommand ||
    process.env['SELF_HEALING_TEST_COMMAND'] ||
    'pnpm test';

  const activityId = log.info('Running tests', {
    repository: input.repository,
    headSha: input.headSha,
    branch: input.branch,
    testCommand,
  });

  try {
    const testResult = await executeTests({
      repository: input.repository,
      headSha: input.headSha,
      branch: input.branch,
      testCommand,
      timeoutMs,
    });

    logger.info('Tests completed', {
      activityId,
      repository: input.repository,
      success: testResult.success,
      duration: testResult.duration,
    });

    return {
      success: testResult.success,
      output: testResult.output || undefined,
      error: testResult.error || undefined,
      duration: testResult.duration,
      retryDiagnosis: undefined,
    };
  } catch (error) {
    logger.error('Test execution failed', {
      activityId,
      repository: input.repository,
      headSha: input.headSha,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      output: undefined,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
      retryDiagnosis: undefined,
    };
  }
}
