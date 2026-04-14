import { z } from 'zod';

/**
 * FailureReport v1 Schema
 * Minimal reproducible log bundle for Claude diagnosis
 */
export const FailureReportSchema = z.object({
  // Metadata
  version: z.literal('v1'),
  timestamp: z.string().datetime(),
  workflowRunId: z.number(),
  repository: z.string(),
  headSha: z.string(),
  branch: z.string(),
  actor: z.string(),
  installationId: z.number(),

  // Failure context
  failureType: z.enum([
    'workflow_failure',
    'test_failure',
    'build_failure',
    'deployment_failure',
  ]),
  failureStep: z.string(),
  failureMessage: z.string(),
  failureCode: z.string().optional(),

  // Logs and outputs (redacted)
  logs: z.object({
    workflowLogs: z.string().optional(),
    buildLogs: z.string().optional(),
    testLogs: z.string().optional(),
    errorLogs: z.string().optional(),
    redactedSecrets: z.array(z.string()).default([]),
  }),

  // Git context
  gitContext: z.object({
    diff: z.string().optional(),
    baseSha: z.string(),
    headSha: z.string(),
    changedFiles: z.array(z.string()).default([]),
    commitMessage: z.string().optional(),
    author: z.string().optional(),
  }),

  // Test outputs
  testOutput: z.object({
    testResults: z.string().optional(),
    coverageReport: z.string().optional(),
    testDuration: z.number().optional(),
    testCount: z.number().optional(),
    failedTests: z.array(z.string()).default([]),
  }),

  // Environment context
  environment: z.object({
    runner: z.string().optional(),
    os: z.string().optional(),
    nodeVersion: z.string().optional(),
    dependencies: z.record(z.string()).optional(),
    environmentVariables: z.array(z.string()).default([]), // Redacted list
  }),

  // Performance metrics
  metrics: z.object({
    duration: z.number(),
    memoryUsage: z.number().optional(),
    cpuUsage: z.number().optional(),
    networkRequests: z.number().optional(),
  }),

  // Previous attempts (for retry context)
  previousAttempts: z
    .array(
      z.object({
        attempt: z.number(),
        timestamp: z.string().datetime(),
        error: z.string(),
        duration: z.number(),
      })
    )
    .default([]),
});

export type FailureReport = z.infer<typeof FailureReportSchema>;

/**
 * Redaction utilities for sensitive data
 */
export class LogRedactor {
  private static readonly SECRET_PATTERNS = [
    // API keys
    /(api[_-]?key|token|secret|password|auth)[_-]?key?\s*[:=]\s*['"]?[a-zA-Z0-9]{20,}['"]?/gi,
    // GitHub tokens
    /gh[po]_[a-zA-Z0-9]{36}/gi,
    // AWS credentials
    /AKIA[0-9A-Z]{16}/gi,
    // Private keys
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    // URLs with tokens
    /https?:\/\/[^/\s]+@[^\s]+/gi,
    // Environment variables with secrets
    /(?:export\s+)?([A-Z_]+)=(?:['"]?)([^'"]{20,})(?:['"]?)/gi,
  ];

  /**
   * Redact sensitive information from logs
   */
  static redactLogs(logs: string): {
    redactedLogs: string;
    redactedSecrets: string[];
  } {
    let redactedLogs = logs;
    const redactedSecrets: string[] = [];

    for (const pattern of this.SECRET_PATTERNS) {
      redactedLogs = redactedLogs.replace(pattern, match => {
        redactedSecrets.push(match);
        return '[REDACTED]';
      });
    }

    return { redactedLogs, redactedSecrets };
  }

  /**
   * Redact environment variables
   */
  static redactEnvironmentVariables(env: Record<string, string>): string[] {
    const sensitiveKeys = [
      'API_KEY',
      'TOKEN',
      'SECRET',
      'PASSWORD',
      'AUTH',
      'GITHUB_TOKEN',
      'AWS_ACCESS_KEY',
      'AWS_SECRET_KEY',
      'DATABASE_URL',
      'REDIS_URL',
      'MONGODB_URI',
    ];

    return Object.keys(env).filter(key =>
      sensitiveKeys.some(sensitive => key.toUpperCase().includes(sensitive))
    );
  }
}

/**
 * Failure report builder
 */
export class FailureReportBuilder {
  private report: Partial<FailureReport> = {
    version: 'v1',
    timestamp: new Date().toISOString(),
    logs: { redactedSecrets: [] },
    gitContext: { changedFiles: [], headSha: '', baseSha: '' },
    testOutput: { failedTests: [] },
    environment: { environmentVariables: [] },
    previousAttempts: [],
  };

  setMetadata(
    workflowRunId: number,
    repository: string,
    headSha: string,
    branch: string,
    actor: string,
    installationId: number
  ): this {
    this.report.workflowRunId = workflowRunId;
    this.report.repository = repository;
    this.report.headSha = headSha;
    this.report.branch = branch;
    this.report.actor = actor;
    this.report.installationId = installationId;
    return this;
  }

  setFailureContext(
    failureType: FailureReport['failureType'],
    failureStep: string,
    failureMessage: string,
    failureCode?: string
  ): this {
    this.report.failureType = failureType;
    this.report.failureStep = failureStep;
    this.report.failureMessage = failureMessage;
    this.report.failureCode = failureCode;
    return this;
  }

  setLogs(logs: {
    workflowLogs?: string;
    buildLogs?: string;
    testLogs?: string;
    errorLogs?: string;
  }): this {
    const redactedLogs: Record<string, string> = {};
    const allRedactedSecrets: string[] = [];

    for (const [key, log] of Object.entries(logs)) {
      if (log) {
        const { redactedLogs: redacted, redactedSecrets } =
          LogRedactor.redactLogs(log);
        redactedLogs[key] = redacted;
        allRedactedSecrets.push(...redactedSecrets);
      }
    }

    this.report.logs = {
      ...redactedLogs,
      redactedSecrets: allRedactedSecrets,
    };
    return this;
  }

  setGitContext(
    baseSha: string,
    headSha: string,
    diff?: string,
    changedFiles?: string[],
    commitMessage?: string,
    author?: string
  ): this {
    this.report.gitContext = {
      baseSha,
      headSha,
      diff,
      changedFiles: changedFiles || [],
      commitMessage,
      author,
    };
    return this;
  }

  setTestOutput(testOutput: {
    testResults?: string;
    coverageReport?: string;
    testDuration?: number;
    testCount?: number;
    failedTests?: string[];
  }): this {
    this.report.testOutput = {
      testResults: testOutput.testResults,
      coverageReport: testOutput.coverageReport,
      testDuration: testOutput.testDuration,
      testCount: testOutput.testCount,
      failedTests: testOutput.failedTests || [],
    };
    return this;
  }

  setEnvironment(environment: {
    runner?: string;
    os?: string;
    nodeVersion?: string;
    dependencies?: Record<string, string>;
    environmentVariables?: Record<string, string>;
  }): this {
    const redactedEnvVars = environment.environmentVariables
      ? LogRedactor.redactEnvironmentVariables(environment.environmentVariables)
      : [];

    this.report.environment = {
      runner: environment.runner,
      os: environment.os,
      nodeVersion: environment.nodeVersion,
      dependencies: environment.dependencies,
      environmentVariables: redactedEnvVars,
    };
    return this;
  }

  setMetrics(metrics: {
    duration: number;
    memoryUsage?: number;
    cpuUsage?: number;
    networkRequests?: number;
  }): this {
    this.report.metrics = metrics;
    return this;
  }

  addPreviousAttempt(attempt: {
    attempt: number;
    timestamp: string;
    error: string;
    duration: number;
  }): this {
    this.report.previousAttempts!.push(attempt);
    return this;
  }

  build(): FailureReport {
    const result = FailureReportSchema.parse(this.report);
    return result;
  }
}
