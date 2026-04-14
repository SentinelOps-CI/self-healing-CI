import { z } from 'zod';

/**
 * Test container configuration schema
 */
export const TestContainerConfigSchema = z.object({
  image: z.string(),
  tag: z.string(),
  environment: z.record(z.string()).default({}),
  volumes: z
    .array(
      z.object({
        host: z.string(),
        container: z.string(),
        mode: z.enum(['ro', 'rw']).default('ro'),
      })
    )
    .default([]),
  ports: z
    .array(
      z.object({
        host: z.number(),
        container: z.number(),
      })
    )
    .default([]),
  command: z.array(z.string()).default([]),
  workingDir: z.string().default('/workspace'),
  timeout: z.number().default(300000), // 5 minutes
  memory: z.string().default('512m'),
  cpu: z.string().default('1.0'),
});

export type TestContainerConfig = z.infer<typeof TestContainerConfigSchema>;

/**
 * Test execution request schema
 */
export const TestExecutionRequestSchema = z.object({
  repository: z.string(),
  headSha: z.string(),
  branch: z.string(),
  testSuite: z.string(),
  /** When set, runs `sh -c "<command>"` in the container (overrides suite command). */
  customShellCommand: z.string().optional(),
  containerConfig: TestContainerConfigSchema,
  installationId: z.number(),
  retryCount: z.number().default(3),
  seed: z.number().optional(),
});

export type TestExecutionRequest = z.infer<typeof TestExecutionRequestSchema>;

/**
 * Test execution result schema
 */
export const TestExecutionResultSchema = z.object({
  success: z.boolean(),
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['passed', 'failed', 'skipped', 'flaky']),
      duration: z.number(),
      error: z.string().optional(),
      output: z.string().optional(),
      retryCount: z.number().default(0),
    })
  ),
  flakinessScore: z.number().min(0).max(1),
  executionTrace: z.string().optional(),
  containerId: z.string().optional(),
  duration: z.number(),
  error: z.string().optional(),
});

export type TestExecutionResult = z.infer<typeof TestExecutionResultSchema>;

/**
 * Flakiness signature schema
 */
export const FlakinessSignatureSchema = z.object({
  testSuite: z.string(),
  stackHash: z.string(),
  seed: z.number(),
  timestamp: z.string().datetime(),
  signature: z.string(),
  confidence: z.number().min(0).max(1),
});

export type FlakinessSignature = z.infer<typeof FlakinessSignatureSchema>;

/**
 * Test trace information
 */
export interface TestTrace {
  testName: string;
  startTime: number;
  endTime: number;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  error?: string;
  output?: string;
  retryCount: number;
  stackTrace?: string;
  seed?: number;
}

/**
 * Container execution context
 */
export interface ContainerExecutionContext {
  containerId: string;
  image: string;
  tag: string;
  environment: Record<string, string>;
  volumes: Array<{
    host: string;
    container: string;
    mode: 'ro' | 'rw';
  }>;
  ports: Array<{
    host: number;
    container: number;
  }>;
  command: string[];
  workingDir: string;
  timeout: number;
  memory: string;
  cpu: string;
}

/**
 * Flakiness detection result
 */
export interface FlakinessDetectionResult {
  isFlaky: boolean;
  confidence: number;
  signature: string;
  stackHash: string;
  seed: number;
  retryResults: Array<{
    attempt: number;
    success: boolean;
    duration: number;
    error?: string;
  }>;
  suggestions: string[];
}

/**
 * Test suite configuration
 */
export interface TestSuiteConfig {
  name: string;
  command: string[];
  timeout: number;
  retryCount: number;
  flakinessThreshold: number;
  deterministic: boolean;
  seedRequired: boolean;
}

/**
 * Default test suite configurations
 */
export const DEFAULT_TEST_SUITES: Record<string, TestSuiteConfig> = {
  unit: {
    name: 'unit',
    command: ['npm', 'run', 'test:unit'],
    timeout: 300000, // 5 minutes
    retryCount: 3,
    flakinessThreshold: 0.1,
    deterministic: true,
    seedRequired: false,
  },
  integration: {
    name: 'integration',
    command: ['npm', 'run', 'test:integration'],
    timeout: 600000, // 10 minutes
    retryCount: 3,
    flakinessThreshold: 0.2,
    deterministic: true,
    seedRequired: true,
  },
  e2e: {
    name: 'e2e',
    command: ['npm', 'run', 'test:e2e'],
    timeout: 900000, // 15 minutes
    retryCount: 3,
    flakinessThreshold: 0.3,
    deterministic: false,
    seedRequired: true,
  },
  performance: {
    name: 'performance',
    command: ['npm', 'run', 'test:performance'],
    timeout: 1200000, // 20 minutes
    retryCount: 2,
    flakinessThreshold: 0.15,
    deterministic: true,
    seedRequired: true,
  },
};

/**
 * Flakiness patterns for detection
 */
export const FLAKINESS_PATTERNS = {
  TIMING: /timeout|deadlock|race condition|timing/i,
  NETWORK: /network error|connection refused|timeout/i,
  RESOURCE: /out of memory|disk space|resource exhausted/i,
  RANDOM: /random|seed|non-deterministic/i,
  ENVIRONMENT: /environment|config|missing dependency/i,
  CONCURRENCY: /concurrent|thread|async|promise/i,
} as const;

/**
 * Flakiness stabilization suggestions
 */
export const FLAKINESS_SUGGESTIONS = {
  TIMING: [
    'Add explicit waits instead of fixed timeouts',
    'Use polling with exponential backoff',
    'Implement proper async/await patterns',
    'Add retry logic with jitter',
  ],
  NETWORK: [
    'Mock external dependencies',
    'Use test doubles for network calls',
    'Implement circuit breaker pattern',
    'Add network timeout configurations',
  ],
  RESOURCE: [
    'Clean up resources after each test',
    'Use resource pools',
    'Implement proper teardown',
    'Monitor resource usage',
  ],
  RANDOM: [
    'Use fixed seeds for random generators',
    'Mock random number generators',
    'Make tests deterministic',
    'Use controlled randomness',
  ],
  ENVIRONMENT: [
    'Isolate test environment',
    'Use dependency injection',
    'Mock environment variables',
    'Create hermetic test containers',
  ],
  CONCURRENCY: [
    'Use proper synchronization primitives',
    'Avoid shared mutable state',
    'Implement proper locking',
    'Use atomic operations',
  ],
} as const;
