import { createHash } from 'node:crypto';
import Docker from 'dockerode';
import { logger } from './logger.js';
import {
  DEFAULT_TEST_SUITES,
  FLAKINESS_PATTERNS,
  FLAKINESS_SUGGESTIONS,
} from './types/test-container.js';
import type {
  FlakinessDetectionResult,
  TestExecutionRequest,
  TestExecutionResult,
  TestSuiteConfig,
} from './types/test-container.js';

export interface FreestyleClientOptions {
  dockerSocket?: string;
  registryUrl?: string;
  defaultTimeout?: number;
  maxRetries?: number;
  flakinessThreshold?: number;
}

export class FreestyleClient {
  private docker: Docker;
  private readonly defaultTimeout: number;
  private readonly maxRetries: number;
  private readonly flakinessThreshold: number;
  private readonly registryUrl?: string;

  constructor(options: FreestyleClientOptions = {}) {
    this.docker = new Docker({
      socketPath: options.dockerSocket || '/var/run/docker.sock',
    });
    this.defaultTimeout = options.defaultTimeout || 300000; // 5 minutes
    this.maxRetries = options.maxRetries || 3;
    this.flakinessThreshold = options.flakinessThreshold || 0.2;
    this.registryUrl = options.registryUrl;
  }

  /**
   * Execute tests in deterministic container
   */
  async executeTests(
    request: TestExecutionRequest
  ): Promise<TestExecutionResult> {
    const startTime = Date.now();
    const executionId = `freestyle-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    logger.info('Executing tests with Freestyle', {
      executionId,
      repository: request.repository,
      testSuite: request.testSuite,
      retryCount: request.retryCount,
    });

    try {
      const testSuiteConfig = this.getTestSuiteConfig(request);

      // Create deterministic container
      const containerId = await this.createDeterministicContainer(
        request,
        testSuiteConfig
      );

      // Execute tests with retries
      const retryResults = await this.executeTestsWithRetries(
        containerId,
        request,
        testSuiteConfig
      );

      // Detect flakiness
      const flakinessResult = this.detectFlakiness(
        retryResults,
        testSuiteConfig
      );

      // Generate execution trace
      const executionTrace = this.generateExecutionTrace(retryResults, request);

      const duration = Date.now() - startTime;
      const success = retryResults.some(result => result.success);

      logger.info('Test execution completed', {
        executionId,
        success,
        flakinessScore: flakinessResult.confidence,
        duration,
      });

      return {
        success,
        testResults: this.aggregateTestResults(retryResults),
        flakinessScore: flakinessResult.confidence,
        executionTrace,
        containerId,
        duration,
      };
    } catch (error) {
      logger.error('Test execution failed', {
        executionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        testResults: [],
        flakinessScore: 0,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create deterministic test container
   */
  private async createDeterministicContainer(
    request: TestExecutionRequest,
    testSuiteConfig: TestSuiteConfig
  ): Promise<string> {
    const containerName = `freestyle-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Build deterministic environment
    const environment = {
      ...request.containerConfig.environment,
      NODE_ENV: 'test',
      CI: 'true',
      FREESTYLE_EXECUTION_ID: containerName,
      TEST_SUITE: request.testSuite,
      ...(request.seed && { TEST_SEED: request.seed.toString() }),
      ...(testSuiteConfig.deterministic && { DETERMINISTIC: 'true' }),
    };

    // Create container with deterministic settings
    const container = await this.docker.createContainer({
      Image: `${request.containerConfig.image}:${request.containerConfig.tag}`,
      name: containerName,
      Env: Object.entries(environment).map(([key, value]) => `${key}=${value}`),
      WorkingDir: request.containerConfig.workingDir,
      Cmd: testSuiteConfig.command,
      HostConfig: {
        Memory: this.parseMemory(request.containerConfig.memory),
        CpuQuota: this.parseCpu(request.containerConfig.cpu),
        Binds: request.containerConfig.volumes.map(
          vol => `${vol.host}:${vol.container}:${vol.mode}`
        ),
        PortBindings: this.createPortBindings(request.containerConfig.ports),
        AutoRemove: true,
        NetworkMode: 'bridge',
      },
      Labels: {
        'freestyle.execution': 'true',
        'freestyle.test-suite': request.testSuite,
        'freestyle.repository': request.repository,
        'freestyle.sha': request.headSha,
      },
    });

    await container.start();
    return container.id;
  }

  /**
   * Execute tests with retry logic
   */
  private async executeTestsWithRetries(
    containerId: string,
    request: TestExecutionRequest,
    testSuiteConfig: TestSuiteConfig
  ): Promise<
    Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }>
  > {
    const retryResults: Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }> = [];

    for (let attempt = 1; attempt <= request.retryCount; attempt++) {
      logger.info('Executing test attempt', {
        containerId,
        attempt,
        maxAttempts: request.retryCount,
      });

      try {
        const result = await this.executeSingleTestRun(
          containerId,
          request,
          testSuiteConfig
        );
        retryResults.push(result);

        // If test passed and we're not checking for flakiness, stop
        if (result.success && !testSuiteConfig.deterministic) {
          break;
        }
      } catch (error) {
        retryResults.push({
          success: false,
          duration: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Wait between retries for deterministic tests
      if (attempt < request.retryCount && testSuiteConfig.deterministic) {
        await this.sleep(1000); // 1 second delay
      }
    }

    return retryResults;
  }

  /**
   * Execute single test run
   */
  private async executeSingleTestRun(
    containerId: string,
    request: TestExecutionRequest,
    testSuiteConfig: TestSuiteConfig
  ): Promise<{
    success: boolean;
    duration: number;
    error?: string;
    output?: string;
  }> {
    const startTime = Date.now();
    const container = this.docker.getContainer(containerId);

    try {
      // Execute command in container
      const exec = await container.exec({
        Cmd: testSuiteConfig.command,
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: request.containerConfig.workingDir,
        Env: Object.entries(request.containerConfig.environment).map(
          ([key, value]) => `${key}=${value}`
        ),
      });

      const stream = await exec.start({});
      let output = '';
      let errorOutput = '';

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            duration: Date.now() - startTime,
            error: 'Test execution timed out',
            output,
          });
        }, testSuiteConfig.timeout);

        stream.on('data', (chunk: Buffer) => {
          const data = chunk.toString();
          if (data.includes('error') || data.includes('Error')) {
            errorOutput += data;
          }
          output += data;
        });

        stream.on('end', () => {
          clearTimeout(timeout);
          const duration = Date.now() - startTime;

          // Determine success based on output
          const success = this.determineTestSuccess(output, errorOutput);

          resolve({
            success,
            duration,
            error: success ? undefined : errorOutput || 'Test execution failed',
            output,
          });
        });

        stream.on('error', (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error:
          error instanceof Error ? error.message : 'Container execution failed',
      };
    }
  }

  /**
   * Detect flakiness in test results
   */
  private detectFlakiness(
    retryResults: Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }>,
    _testSuiteConfig: TestSuiteConfig
  ): FlakinessDetectionResult {
    const successfulRuns = retryResults.filter(result => result.success);
    const failedRuns = retryResults.filter(result => !result.success);

    const isFlaky = successfulRuns.length > 0 && failedRuns.length > 0;
    const confidence = this.calculateFlakinessConfidence(retryResults);

    // Generate flakiness signature
    const stackHash = this.generateStackHash(retryResults);
    const signature = this.generateFlakinessSignature(retryResults);

    // Determine flakiness type and suggestions
    const flakinessType = this.determineFlakinessType(retryResults);
    const suggestions = FLAKINESS_SUGGESTIONS[flakinessType] || [];

    return {
      isFlaky,
      confidence,
      signature,
      stackHash,
      seed: Date.now(), // Use timestamp as seed
      retryResults: retryResults.map((r, i) => ({
        attempt: i + 1,
        success: r.success,
        duration: r.duration,
        error: r.error,
      })),
      suggestions: [...suggestions],
    };
  }

  /**
   * Calculate flakiness confidence score
   */
  private calculateFlakinessConfidence(
    retryResults: Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }>
  ): number {
    if (retryResults.length < 2) return 0;

    const successCount = retryResults.filter(r => r.success).length;
    const totalCount = retryResults.length;

    // Higher confidence when results are mixed
    const successRatio = successCount / totalCount;
    const confidence = Math.abs(0.5 - successRatio) * 2; // 0-1 scale

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate stack hash for flakiness signature
   */
  private generateStackHash(
    retryResults: Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }>
  ): string {
    const errorMessages = retryResults
      .filter(r => r.error)
      .map(r => r.error)
      .join('|');

    return createHash('sha256')
      .update(errorMessages)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Generate flakiness signature
   */
  private generateFlakinessSignature(
    retryResults: Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }>
  ): string {
    const signature = {
      successPattern: retryResults.map(r => (r.success ? 1 : 0)),
      durationPattern: retryResults.map(r => Math.floor(r.duration / 1000)), // seconds
      errorPattern: retryResults.map(r => (r.error ? 1 : 0)),
    };

    return createHash('sha256')
      .update(JSON.stringify(signature))
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Determine flakiness type
   */
  private determineFlakinessType(
    retryResults: Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }>
  ): keyof typeof FLAKINESS_PATTERNS {
    const allErrors = retryResults
      .filter(r => r.error)
      .map(r => r.error!)
      .join(' ');

    for (const [type, pattern] of Object.entries(FLAKINESS_PATTERNS)) {
      if (pattern.test(allErrors)) {
        return type as keyof typeof FLAKINESS_PATTERNS;
      }
    }

    return 'TIMING'; // Default to timing issues
  }

  /**
   * Determine test success from output
   */
  private determineTestSuccess(output: string, errorOutput: string): boolean {
    const successIndicators = [
      /✓ \d+ tests? passed/i,
      /PASS/i,
      /SUCCESS/i,
      /All tests passed/i,
      /Test completed successfully/i,
    ];

    const failureIndicators = [
      /✗ \d+ tests? failed/i,
      /FAIL/i,
      /ERROR/i,
      /Test failed/i,
      /Assertion failed/i,
    ];

    // Check for success indicators
    for (const indicator of successIndicators) {
      if (indicator.test(output)) {
        return true;
      }
    }

    // Check for failure indicators
    for (const indicator of failureIndicators) {
      if (indicator.test(output) || indicator.test(errorOutput)) {
        return false;
      }
    }

    // Default to success if no clear indicators
    return !errorOutput || errorOutput.length === 0;
  }

  /**
   * Resolve command and retry settings from suite name or `customShellCommand`.
   */
  private getTestSuiteConfig(request: TestExecutionRequest): TestSuiteConfig {
    const custom = request.customShellCommand?.trim();
    if (custom) {
      return {
        name: 'custom',
        command: ['sh', '-c', custom],
        timeout: request.containerConfig.timeout,
        retryCount: request.retryCount,
        flakinessThreshold: this.flakinessThreshold,
        deterministic: false,
        seedRequired: false,
      };
    }

    const testSuite = request.testSuite;
    return (
      DEFAULT_TEST_SUITES[testSuite] || {
        name: testSuite,
        command: ['npm', 'test'],
        timeout: request.containerConfig.timeout,
        retryCount: request.retryCount,
        flakinessThreshold: this.flakinessThreshold,
        deterministic: true,
        seedRequired: false,
      }
    );
  }

  /**
   * Aggregate test results from retries
   */
  private aggregateTestResults(
    retryResults: Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }>
  ): Array<{
    name: string;
    status: 'passed' | 'failed' | 'skipped' | 'flaky';
    duration: number;
    error?: string;
    output?: string;
    retryCount: number;
  }> {
    // For now, return a single aggregated result
    const successCount = retryResults.filter(r => r.success).length;
    const totalCount = retryResults.length;
    const avgDuration =
      retryResults.reduce((sum, r) => sum + r.duration, 0) / totalCount;

    let status: 'passed' | 'failed' | 'skipped' | 'flaky';
    if (successCount === totalCount) {
      status = 'passed';
    } else if (successCount === 0) {
      status = 'failed';
    } else {
      status = 'flaky';
    }

    return [
      {
        name: 'aggregated-test-results',
        status,
        duration: avgDuration,
        error: status === 'failed' ? retryResults[0]?.error : undefined,
        output: retryResults[0]?.output,
        retryCount: totalCount,
      },
    ];
  }

  /**
   * Generate execution trace
   */
  private generateExecutionTrace(
    retryResults: Array<{
      success: boolean;
      duration: number;
      error?: string;
      output?: string;
    }>,
    request: TestExecutionRequest
  ): string {
    const trace = {
      executionId: `freestyle-${Date.now()}`,
      repository: request.repository,
      testSuite: request.testSuite,
      headSha: request.headSha,
      timestamp: new Date().toISOString(),
      retryResults: retryResults.map((result, index) => ({
        attempt: index + 1,
        success: result.success,
        duration: result.duration,
        error: result.error,
      })),
    };

    return JSON.stringify(trace, null, 2);
  }

  /**
   * Utility methods
   */
  private parseMemory(memory: string): number {
    const match = memory.match(/^(\d+)([kmg])?$/i);
    if (!match) return 512 * 1024 * 1024; // Default 512MB

    const value = parseInt(match[1]!, 10);
    const unit = (match[2] ?? '').toLowerCase();

    switch (unit) {
      case 'k':
        return value * 1024;
      case 'm':
        return value * 1024 * 1024;
      case 'g':
        return value * 1024 * 1024 * 1024;
      default:
        return value * 1024 * 1024; // Assume MB
    }
  }

  private parseCpu(cpu: string): number {
    const value = parseFloat(cpu);
    return Math.floor(value * 100000); // Convert to microseconds
  }

  private createPortBindings(
    ports: Array<{ host: number; container: number }>
  ): Record<string, Array<{ HostPort: string }>> {
    const bindings: Record<string, Array<{ HostPort: string }>> = {};

    for (const port of ports) {
      bindings[`${port.container}/tcp`] = [{ HostPort: port.host.toString() }];
    }

    return bindings;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
