/**
 * Domain types for failure collection, diagnosis, and downstream activities.
 */

export interface FailureData {
  buildLogs: string;
  baseSha: string;
  changedFiles: string[];
  commitMessage: string;
  author: string;
  duration: number;
  failedTests: string[];
  runner: string;
  os: string;
  nodeVersion: string;
  dependencies: Record<string, string>;
  environment: Record<string, string>;
  memoryUsage: number;
  cpuUsage: number;
  networkRequests: number;
}

export interface TestFailure {
  success: boolean;
  error?: string;
  output?: string;
  retryDiagnosis?: boolean;
}

/** Reserved for future workflow payloads that bundle Claude context explicitly. */
export interface ClaudeInput {
  repository: string;
  workflowRunId: number;
  headSha: string;
  branch: string;
  installationId: number;
  failureData: FailureData;
  testFailure?: TestFailure;
}

export interface ClaudeResult {
  rootCause: string;
  confidence: number;
  patch: string;
  explanation: string;
  logs: string;
}
