import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { FailureReport } from './types/failure-report.js';
import { logger } from './logger.js';

// Claude response schema
const ClaudeResponseSchema = z.object({
  rootCause: z.enum([
    'DEP_UPGRADE',
    'API_CHANGE',
    'FLAKY_TEST',
    'CONFIG_ERROR',
    'ENV_ISSUE',
    'PERMISSION_ERROR',
    'TIMEOUT',
    'UNKNOWN',
  ]),
  confidence: z.number().min(0).max(100),
  patch: z.string().optional(),
  explanation: z.string(),
  suggestedActions: z.array(z.string()).optional(),
  estimatedFixTime: z.number().optional(), // in minutes
});

export type ClaudeResponse = z.infer<typeof ClaudeResponseSchema>;

export interface ClaudeInvocationOptions {
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  retryAttempts?: number;
  timeoutMs?: number;
}

export interface ClaudeInvocationResult {
  response: ClaudeResponse;
  tokensUsed: number;
  model: string;
  duration: number;
  retryCount: number;
}

export class ClaudeClient {
  private client: Anthropic;
  private readonly defaultMaxTokens = 16000;
  private readonly defaultTemperature = 0.1;
  private readonly defaultRetryAttempts = 3;

  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      maxRetries: 0, // We handle retries ourselves
    });
  }

  /**
   * Invoke Claude with failure report for diagnosis
   */
  async invokeWithFailureReport(
    failureReport: FailureReport,
    options: ClaudeInvocationOptions = {}
  ): Promise<ClaudeInvocationResult> {
    const startTime = Date.now();
    const invocationId = `claude-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    logger.info('Invoking Claude with failure report', {
      invocationId,
      repository: failureReport.repository,
      workflowRunId: failureReport.workflowRunId,
      failureType: failureReport.failureType,
      maxTokens: options.maxTokens || this.defaultMaxTokens,
    });

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(failureReport);

    // Token budget management
    const estimatedTokens = this.estimateTokenCount(systemPrompt + userPrompt);
    const maxTokens = Math.min(
      options.maxTokens || this.defaultMaxTokens,
      this.defaultMaxTokens
    );

    if (estimatedTokens > maxTokens * 0.8) {
      logger.warn('Token budget exceeded, truncating input', {
        invocationId,
        estimatedTokens,
        maxTokens,
      });

      // Truncate the failure report
      const truncatedReport = this.truncateFailureReport(
        failureReport,
        maxTokens
      );
      const truncatedUserPrompt = this.buildUserPrompt(truncatedReport);

      return this.invokeClaude(
        systemPrompt,
        truncatedUserPrompt,
        options,
        invocationId,
        startTime
      );
    }

    return this.invokeClaude(
      systemPrompt,
      userPrompt,
      options,
      invocationId,
      startTime
    );
  }

  /**
   * Invoke Claude with streaming support
   */
  private async invokeClaude(
    systemPrompt: string,
    userPrompt: string,
    options: ClaudeInvocationOptions,
    invocationId: string,
    startTime: number
  ): Promise<ClaudeInvocationResult> {
    const maxTokens = options.maxTokens || this.defaultMaxTokens;
    const temperature = options.temperature || this.defaultTemperature;
    const retryAttempts = options.retryAttempts || this.defaultRetryAttempts;
    let lastError: Error | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        logger.info('Claude invocation attempt', {
          invocationId,
          attempt: attempt + 1,
          maxRetries: retryAttempts,
        });

        const response = await this.client.messages.create({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          stream: false,
        });

        return this.handleNonStreamingResponse(
          response,
          invocationId,
          startTime,
          retryCount
        );
      } catch (error) {
        lastError = error as Error;
        retryCount = attempt;

        logger.warn('Claude invocation failed', {
          invocationId,
          attempt: attempt + 1,
          error: lastError.message,
          retryable: this.isRetryableError(lastError),
        });

        if (attempt < retryAttempts && this.isRetryableError(lastError)) {
          const backoffDelay = this.calculateBackoffDelay(attempt);
          logger.info('Retrying Claude invocation', {
            invocationId,
            attempt: attempt + 1,
            backoffDelay,
          });
          await this.sleep(backoffDelay);
        } else {
          break;
        }
      }
    }

    // All retries exhausted
    logger.error('Claude invocation failed after all retries', {
      invocationId,
      retryCount,
      error: lastError?.message,
      duration: Date.now() - startTime,
    });

    // Return fallback response
    return this.createFallbackResponse(
      invocationId,
      startTime,
      retryCount,
      lastError
    );
  }

  /**
   * Handle non-streaming response from Claude
   */
  private handleNonStreamingResponse(
    response: any,
    invocationId: string,
    startTime: number,
    retryCount: number
  ): ClaudeInvocationResult {
    const content = response.content[0]?.text || '';
    const tokensUsed = response.usage?.output_tokens || 0;
    const duration = Date.now() - startTime;

    const parsedResponse = this.parseClaudeResponse(content);

    logger.info('Claude non-streaming response completed', {
      invocationId,
      tokensUsed,
      responseLength: content.length,
      duration,
    });

    return {
      response: parsedResponse,
      tokensUsed,
      model: 'claude-3-5-haiku-20241022',
      duration,
      retryCount,
    };
  }

  /**
   * Parse Claude response and validate schema
   */
  private parseClaudeResponse(content: string): ClaudeResponse {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const jsonResponse = JSON.parse(jsonMatch[0]);
      return ClaudeResponseSchema.parse(jsonResponse);
    } catch (error) {
      logger.warn('Failed to parse Claude response, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        content: content.substring(0, 500),
      });

      // Return fallback response
      return {
        rootCause: 'UNKNOWN',
        confidence: 0,
        explanation: 'Failed to parse AI diagnosis response',
      };
    }
  }

  /**
   * Build system prompt for Claude
   */
  private buildSystemPrompt(): string {
    return `You are a senior infrastructure engineer specializing in CI/CD systems and DevOps automation.

Your task is to analyze failed GitHub workflow runs and determine the root cause with high accuracy.

AVAILABLE ROOT CAUSES:
- DEP_UPGRADE: Dependency version issues, package.json changes, lock file conflicts, version mismatches
- API_CHANGE: Breaking API changes, deprecated methods, interface changes, SDK updates
- FLAKY_TEST: Non-deterministic tests, timing issues, race conditions, intermittent failures
- CONFIG_ERROR: Configuration file issues, environment variables, build settings, missing configs
- ENV_ISSUE: Environment-specific issues, missing dependencies, platform differences, OS-specific problems
- PERMISSION_ERROR: Access denied, authentication issues, token problems, insufficient privileges
- TIMEOUT: Timeout issues, resource constraints, slow operations, network timeouts
- UNKNOWN: Unable to determine specific cause, insufficient information

ANALYSIS REQUIREMENTS:
1. Carefully examine all provided logs, diffs, and test outputs
2. Identify the most likely root cause from the enum above
3. Provide a confidence score (0-100) based on evidence strength
4. Generate a precise patch if applicable (unified diff format)
5. Explain your reasoning clearly and concisely
6. Suggest additional actions if needed
7. Estimate fix time if possible

RESPONSE FORMAT:
Return a valid JSON object with these fields:
{
  "rootCause": "ENUM_VALUE",
  "confidence": 85,
  "patch": "diff content if applicable",
  "explanation": "Detailed explanation of the issue and solution",
  "suggestedActions": ["action1", "action2"],
  "estimatedFixTime": 15
}

IMPORTANT:
- Be conservative with confidence scores
- Only provide patches if you're highly confident
- Focus on the most actionable root cause
- Consider the broader CI/CD context
- Validate that patches would actually fix the issue`;
  }

  /**
   * Build user prompt from failure report
   */
  private buildUserPrompt(failureReport: FailureReport): string {
    return `Analyze this failed workflow run:

REPOSITORY: ${failureReport.repository}
WORKFLOW RUN ID: ${failureReport.workflowRunId}
BRANCH: ${failureReport.branch}
HEAD SHA: ${failureReport.headSha}
ACTOR: ${failureReport.actor}
FAILURE TYPE: ${failureReport.failureType}
FAILURE STEP: ${failureReport.failureStep}
FAILURE MESSAGE: ${failureReport.failureMessage}
${failureReport.failureCode ? `FAILURE CODE: ${failureReport.failureCode}` : ''}

WORKFLOW LOGS:
${failureReport.logs.workflowLogs || 'No workflow logs available'}

BUILD LOGS:
${failureReport.logs.buildLogs || 'No build logs available'}

TEST LOGS:
${failureReport.logs.testLogs || 'No test logs available'}

ERROR LOGS:
${failureReport.logs.errorLogs || 'No error logs available'}

GIT DIFF:
${failureReport.gitContext.diff || 'No diff available'}

CHANGED FILES:
${failureReport.gitContext.changedFiles.join('\n') || 'No files changed'}

TEST RESULTS:
${failureReport.testOutput.testResults || 'No test results available'}

FAILED TESTS:
${failureReport.testOutput.failedTests.join('\n') || 'No failed tests'}

ENVIRONMENT:
- Runner: ${failureReport.environment.runner || 'Unknown'}
- OS: ${failureReport.environment.os || 'Unknown'}
- Node Version: ${failureReport.environment.nodeVersion || 'Unknown'}

DURATION: ${failureReport.metrics.duration}ms

${
  failureReport.previousAttempts.length > 0
    ? `
PREVIOUS ATTEMPTS:
${failureReport.previousAttempts
  .map(
    attempt =>
      `Attempt ${attempt.attempt}: ${attempt.error} (${attempt.duration}ms)`
  )
  .join('\n')}`
    : ''
}

Please diagnose the root cause and provide a solution.`;
  }

  /**
   * Estimate token count for input
   */
  private estimateTokenCount(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncate failure report to fit token budget
   */
  private truncateFailureReport(
    failureReport: FailureReport,
    maxTokens: number
  ): FailureReport {
    const truncated = { ...failureReport };

    // Prioritize keeping the most important information
    const priorityFields = [
      'failureMessage',
      'logs.errorLogs',
      'logs.testLogs',
      'gitContext.diff',
      'testOutput.failedTests',
    ];

    // Simple truncation strategy - keep first N characters of each important field
    const charsPerField = Math.floor((maxTokens * 4) / priorityFields.length);

    if (
      truncated.logs.errorLogs &&
      truncated.logs.errorLogs.length > charsPerField
    ) {
      truncated.logs.errorLogs =
        truncated.logs.errorLogs.substring(0, charsPerField) + '...';
    }

    if (
      truncated.logs.testLogs &&
      truncated.logs.testLogs.length > charsPerField
    ) {
      truncated.logs.testLogs =
        truncated.logs.testLogs.substring(0, charsPerField) + '...';
    }

    if (
      truncated.gitContext.diff &&
      truncated.gitContext.diff.length > charsPerField
    ) {
      truncated.gitContext.diff =
        truncated.gitContext.diff.substring(0, charsPerField) + '...';
    }

    return truncated;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'rate_limit_exceeded',
      'timeout',
      'network_error',
      'server_error',
      'temporary_error',
    ];

    return retryableErrors.some(retryableError =>
      error.message.toLowerCase().includes(retryableError)
    );
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    return delay + Math.random() * 1000; // Add jitter
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create fallback response when all retries fail
   */
  private createFallbackResponse(
    invocationId: string,
    startTime: number,
    retryCount: number,
    error: Error | null
  ): ClaudeInvocationResult {
    logger.error('Using fallback response due to Claude failure', {
      invocationId,
      retryCount,
      error: error?.message,
    });

    return {
      response: {
        rootCause: 'UNKNOWN',
        confidence: 0,
        explanation: `Failed to get AI diagnosis after ${retryCount} retries: ${
          error?.message || 'Unknown error'
        }`,
      },
      tokensUsed: 0,
      model: 'claude-3-5-haiku-20241022',
      duration: Date.now() - startTime,
      retryCount,
    };
  }
}
