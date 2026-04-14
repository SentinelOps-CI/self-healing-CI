import { ClaudeClient, FailureReportBuilder } from '@self-healing-ci/claude';
import { log } from '@temporalio/activity';
import { getSelfHealingEnv } from '../config/self-healing-env.js';
import type { FailureData, TestFailure } from '../types/failure-data.js';
import { logger } from '../utils/logger.js';
import { mapRootCauseString } from '../lib/root-cause.js';
import { RootCause } from '../workflows/self-healing-workflow.js';

export interface DiagnoseFailureInput {
  repository: string;
  workflowRunId: number;
  headSha: string;
  branch: string;
  installationId: number;
  actor?: string;
  failureData: FailureData;
  testFailure?: TestFailure;
}

export interface DiagnoseFailureResult {
  success: boolean;
  rootCause: RootCause;
  confidence: number;
  explanation: string;
  patch: string | undefined;
  error: string | undefined;
}

/**
 * Activity to diagnose CI failures using Claude AI
 */
export async function diagnoseFailure(
  input: DiagnoseFailureInput
): Promise<DiagnoseFailureResult> {
  const startTime = Date.now();
  const activityId = log.info('Diagnosing failure', {
    repository: input.repository,
    workflowRunId: input.workflowRunId,
    headSha: input.headSha,
    branch: input.branch,
  });

  const env = getSelfHealingEnv();

  try {
    if (env.dryRun) {
      return {
        success: true,
        rootCause: RootCause.UNKNOWN,
        confidence: 0,
        explanation: 'SELF_HEALING_DRY_RUN: diagnosis skipped',
        patch: undefined,
        error: undefined,
      };
    }

    const apiKey = process.env['ANTHROPIC_API_KEY'] || '';
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY');
    }

    const report = new FailureReportBuilder()
      .setMetadata(
        input.workflowRunId,
        input.repository,
        input.headSha,
        input.branch,
        input.actor || 'unknown',
        input.installationId
      )
      .setFailureContext(
        'workflow_failure',
        'github_actions',
        input.failureData.buildLogs.slice(0, 2000) || 'No build logs',
        undefined
      )
      .setLogs({
        workflowLogs: input.failureData.buildLogs,
        buildLogs: input.failureData.buildLogs,
        testLogs: input.testFailure?.output,
        errorLogs: input.testFailure?.error,
      })
      .setGitContext(
        input.failureData.baseSha,
        input.headSha,
        undefined,
        input.failureData.changedFiles,
        input.failureData.commitMessage,
        input.failureData.author
      )
      .setTestOutput({
        testResults: input.testFailure?.output,
        failedTests: [],
      })
      .setEnvironment({
        runner: input.failureData.runner,
        os: input.failureData.os,
        nodeVersion: input.failureData.nodeVersion,
        dependencies: input.failureData.dependencies,
      })
      .setMetrics({
        duration: input.failureData.duration,
        memoryUsage: input.failureData.memoryUsage,
        cpuUsage: input.failureData.cpuUsage,
        networkRequests: input.failureData.networkRequests,
      })
      .build();

    const client = new ClaudeClient(apiKey);
    const result = await client.invokeWithFailureReport(report, {
      timeoutMs: 120_000,
      maxTokens: 8192,
    });

    const rawRc = result.response.rootCause;
    const confidence01 = Math.min(
      1,
      Math.max(0, result.response.confidence / 100)
    );
    let rootCause = mapRootCauseString(rawRc);
    if (confidence01 < 0.3) {
      rootCause = RootCause.UNKNOWN;
    }

    logger.info('Failure diagnosis completed', {
      activityId,
      repository: input.repository,
      rootCause,
      confidence: confidence01,
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      rootCause,
      confidence: confidence01,
      explanation: result.response.explanation,
      patch: result.response.patch,
      error: undefined,
    };
  } catch (error) {
    logger.error('Failure diagnosis failed', {
      activityId,
      repository: input.repository,
      workflowRunId: input.workflowRunId,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      rootCause: RootCause.UNKNOWN,
      confidence: 0,
      explanation: error instanceof Error ? error.message : 'Unknown error',
      error: error instanceof Error ? error.message : 'Unknown error',
      patch: undefined,
    };
  }
}
