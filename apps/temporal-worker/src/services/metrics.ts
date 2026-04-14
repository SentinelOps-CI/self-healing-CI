/* eslint-disable @typescript-eslint/ban-ts-comment -- prom-client API surface */
// @ts-nocheck — prom-client typings drift; metrics are auxiliary to the MVP path.
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { logger } from '../utils/logger';

// Create a custom registry
export const register = new Registry();

// MTTR (Mean Time To Recovery) metrics
export const mttrHistogram = new Histogram({
  name: 'self_healing_mttr_seconds',
  help: 'Time to recovery for failed workflows',
  labelNames: ['repository', 'root_cause', 'workflow_state'],
  buckets: [30, 60, 120, 300, 600, 900, 1800], // 30s to 30min
  registers: [register],
});

export const mttrGauge = new Gauge({
  name: 'self_healing_mttr_p95_seconds',
  help: '95th percentile MTTR in seconds',
  labelNames: ['repository'],
  registers: [register],
});

export const mttrP99Gauge = new Gauge({
  name: 'self_healing_mttr_p99_seconds',
  help: '99th percentile MTTR in seconds',
  labelNames: ['repository'],
  registers: [register],
});

// Diagnosis accuracy metrics
export const diagnosisAccuracyGauge = new Gauge({
  name: 'self_healing_diagnosis_accuracy_percent',
  help: 'Diagnosis accuracy percentage',
  labelNames: ['repository', 'root_cause'],
  registers: [register],
});

export const diagnosisAttemptsCounter = new Counter({
  name: 'self_healing_diagnosis_attempts_total',
  help: 'Total number of diagnosis attempts',
  labelNames: ['repository', 'root_cause', 'success'],
  registers: [register],
});

// Proof validation metrics
export const proofRuntimeHistogram = new Histogram({
  name: 'self_healing_proof_runtime_seconds',
  help: 'Proof validation runtime in seconds',
  labelNames: ['repository', 'proof_type', 'verdict'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const proofSuccessRateGauge = new Gauge({
  name: 'self_healing_proof_success_rate_percent',
  help: 'Proof validation success rate percentage',
  labelNames: ['repository', 'proof_type'],
  registers: [register],
});

export const proofAttemptsCounter = new Counter({
  name: 'self_healing_proof_attempts_total',
  help: 'Total number of proof validation attempts',
  labelNames: ['repository', 'proof_type', 'verdict'],
  registers: [register],
});

// Patch application metrics
export const patchSuccessRateGauge = new Gauge({
  name: 'self_healing_patch_success_rate_percent',
  help: 'Patch application success rate percentage',
  labelNames: ['repository', 'language'],
  registers: [register],
});

export const patchAttemptsCounter = new Counter({
  name: 'self_healing_patch_attempts_total',
  help: 'Total number of patch application attempts',
  labelNames: ['repository', 'language', 'success'],
  registers: [register],
});

// Test execution metrics
export const testRuntimeHistogram = new Histogram({
  name: 'self_healing_test_runtime_seconds',
  help: 'Test execution runtime in seconds',
  labelNames: ['repository', 'test_suite', 'flakiness_detected'],
  buckets: [30, 60, 120, 300, 600, 900],
  registers: [register],
});

export const testSuccessRateGauge = new Gauge({
  name: 'self_healing_test_success_rate_percent',
  help: 'Test execution success rate percentage',
  labelNames: ['repository', 'test_suite'],
  registers: [register],
});

export const flakinessDetectionCounter = new Counter({
  name: 'self_healing_flakiness_detections_total',
  help: 'Total number of flakiness detections',
  labelNames: ['repository', 'test_suite', 'severity'],
  registers: [register],
});

// Workflow state metrics
export const workflowStateGauge = new Gauge({
  name: 'self_healing_workflow_state',
  help: 'Current workflow state',
  labelNames: ['repository', 'workflow_id', 'state'],
  registers: [register],
});

export const workflowDurationHistogram = new Histogram({
  name: 'self_healing_workflow_duration_seconds',
  help: 'Total workflow duration in seconds',
  labelNames: ['repository', 'final_state', 'success'],
  buckets: [60, 300, 600, 900, 1800, 3600],
  registers: [register],
});

// Error and failure metrics
export const errorCounter = new Counter({
  name: 'self_healing_errors_total',
  help: 'Total number of errors by type',
  labelNames: ['repository', 'error_type', 'activity'],
  registers: [register],
});

export const failureCounter = new Counter({
  name: 'self_healing_failures_total',
  help: 'Total number of workflow failures',
  labelNames: ['repository', 'failure_reason', 'workflow_state'],
  registers: [register],
});

// Resource utilization metrics
export const cpuUsageGauge = new Gauge({
  name: 'self_healing_cpu_usage_percent',
  help: 'CPU usage percentage',
  labelNames: ['service'],
  registers: [register],
});

export const memoryUsageGauge = new Gauge({
  name: 'self_healing_memory_usage_bytes',
  help: 'Memory usage in bytes',
  labelNames: ['service'],
  registers: [register],
});

export const activeWorkflowsGauge = new Gauge({
  name: 'self_healing_active_workflows',
  help: 'Number of active workflows',
  labelNames: ['repository'],
  registers: [register],
});

// API performance metrics
export const apiLatencyHistogram = new Histogram({
  name: 'self_healing_api_latency_seconds',
  help: 'API request latency in seconds',
  labelNames: ['service', 'endpoint', 'method'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const apiRequestsCounter = new Counter({
  name: 'self_healing_api_requests_total',
  help: 'Total number of API requests',
  labelNames: ['service', 'endpoint', 'method', 'status_code'],
  registers: [register],
});

// SLO compliance metrics
export const sloComplianceGauge = new Gauge({
  name: 'self_healing_slo_compliance_percent',
  help: 'SLO compliance percentage',
  labelNames: ['slo_name', 'repository'],
  registers: [register],
});

export const sloViolationCounter = new Counter({
  name: 'self_healing_slo_violations_total',
  help: 'Total number of SLO violations',
  labelNames: ['slo_name', 'repository', 'severity'],
  registers: [register],
});

/**
 * Records MTTR for a workflow
 */
export function recordMTTR(
  repository: string,
  rootCause: string,
  workflowState: string,
  durationMs: number
): void {
  const durationSeconds = durationMs / 1000;

  mttrHistogram
    .labels(repository, rootCause, workflowState)
    .observe(durationSeconds);

  logger.info('Recorded MTTR', {
    repository,
    rootCause,
    workflowState,
    durationSeconds,
  });
}

/**
 * Records diagnosis accuracy
 */
export function recordDiagnosisAccuracy(
  repository: string,
  rootCause: string,
  accuracy: number
): void {
  diagnosisAccuracyGauge.labels(repository, rootCause).set(accuracy);

  logger.info('Recorded diagnosis accuracy', {
    repository,
    rootCause,
    accuracy,
  });
}

/**
 * Records diagnosis attempt
 */
export function recordDiagnosisAttempt(
  repository: string,
  rootCause: string,
  success: boolean
): void {
  diagnosisAttemptsCounter
    .labels(repository, rootCause, success.toString())
    .inc();

  logger.info('Recorded diagnosis attempt', {
    repository,
    rootCause,
    success,
  });
}

/**
 * Records proof validation metrics
 */
export function recordProofValidation(
  repository: string,
  proofType: string,
  verdict: string,
  durationMs: number
): void {
  const durationSeconds = durationMs / 1000;

  proofRuntimeHistogram
    .labels(repository, proofType, verdict)
    .observe(durationSeconds);

  proofAttemptsCounter.labels(repository, proofType, verdict).inc();

  logger.info('Recorded proof validation', {
    repository,
    proofType,
    verdict,
    durationSeconds,
  });
}

/**
 * Records patch application metrics
 */
export function recordPatchApplication(
  repository: string,
  language: string,
  success: boolean
): void {
  patchAttemptsCounter.labels(repository, language, success.toString()).inc();

  logger.info('Recorded patch application', {
    repository,
    language,
    success,
  });
}

/**
 * Records test execution metrics
 */
export function recordTestExecution(
  repository: string,
  testSuite: string,
  flakinessDetected: boolean,
  durationMs: number
): void {
  const durationSeconds = durationMs / 1000;

  testRuntimeHistogram
    .labels(repository, testSuite, flakinessDetected.toString())
    .observe(durationSeconds);

  logger.info('Recorded test execution', {
    repository,
    testSuite,
    flakinessDetected,
    durationSeconds,
  });
}

/**
 * Records flakiness detection
 */
export function recordFlakinessDetection(
  repository: string,
  testSuite: string,
  severity: 'low' | 'medium' | 'high'
): void {
  flakinessDetectionCounter.labels(repository, testSuite, severity).inc();

  logger.info('Recorded flakiness detection', {
    repository,
    testSuite,
    severity,
  });
}

/**
 * Records workflow state
 */
export function recordWorkflowState(
  repository: string,
  workflowId: string,
  state: string
): void {
  // Reset all states for this workflow
  Object.values(workflowStateGauge.labelNames).forEach(labelName => {
    if (labelName !== 'state') {
      workflowStateGauge.labels(repository, workflowId, labelName).set(0);
    }
  });

  // Set current state
  workflowStateGauge.labels(repository, workflowId, state).set(1);

  logger.info('Recorded workflow state', {
    repository,
    workflowId,
    state,
  });
}

/**
 * Records workflow completion
 */
export function recordWorkflowCompletion(
  repository: string,
  finalState: string,
  success: boolean,
  durationMs: number
): void {
  const durationSeconds = durationMs / 1000;

  workflowDurationHistogram
    .labels(repository, finalState, success.toString())
    .observe(durationSeconds);

  logger.info('Recorded workflow completion', {
    repository,
    finalState,
    success,
    durationSeconds,
  });
}

/**
 * Records error
 */
export function recordError(
  repository: string,
  errorType: string,
  activity: string
): void {
  errorCounter.labels(repository, errorType, activity).inc();

  logger.info('Recorded error', {
    repository,
    errorType,
    activity,
  });
}

/**
 * Records failure
 */
export function recordFailure(
  repository: string,
  failureReason: string,
  workflowState: string
): void {
  failureCounter.labels(repository, failureReason, workflowState).inc();

  logger.info('Recorded failure', {
    repository,
    failureReason,
    workflowState,
  });
}

/**
 * Records API request
 */
export function recordAPIRequest(
  service: string,
  endpoint: string,
  method: string,
  statusCode: number,
  durationMs: number
): void {
  const durationSeconds = durationMs / 1000;

  apiLatencyHistogram
    .labels(service, endpoint, method)
    .observe(durationSeconds);

  apiRequestsCounter
    .labels(service, endpoint, method, statusCode.toString())
    .inc();

  logger.info('Recorded API request', {
    service,
    endpoint,
    method,
    statusCode,
    durationSeconds,
  });
}

/**
 * Records SLO compliance
 */
export function recordSLOCompliance(
  sloName: string,
  repository: string,
  compliancePercent: number
): void {
  sloComplianceGauge.labels(sloName, repository).set(compliancePercent);

  logger.info('Recorded SLO compliance', {
    sloName,
    repository,
    compliancePercent,
  });
}

/**
 * Records SLO violation
 */
export function recordSLOViolation(
  sloName: string,
  repository: string,
  severity: 'low' | 'medium' | 'high'
): void {
  sloViolationCounter.labels(sloName, repository, severity).inc();

  logger.info('Recorded SLO violation', {
    sloName,
    repository,
    severity,
  });
}

/**
 * Updates resource utilization metrics
 */
export function updateResourceUtilization(
  service: string,
  cpuPercent: number,
  memoryBytes: number
): void {
  cpuUsageGauge.labels(service).set(cpuPercent);

  memoryUsageGauge.labels(service).set(memoryBytes);

  logger.info('Updated resource utilization', {
    service,
    cpuPercent,
    memoryBytes,
  });
}

/**
 * Updates active workflows count
 */
export function updateActiveWorkflows(repository: string, count: number): void {
  activeWorkflowsGauge.labels(repository).set(count);

  logger.info('Updated active workflows', {
    repository,
    count,
  });
}

/**
 * Gets metrics as Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/**
 * Calculates and updates SLO metrics
 */
export function calculateSLOMetrics(repository: string): void {
  // Calculate MTTR p95 and p99
  const mttrValues = mttrHistogram.get();
  const repositoryMttrValues = mttrValues.values.filter(
    v => v.labels.repository === repository
  );

  if (repositoryMttrValues.length > 0) {
    const durations = repositoryMttrValues.map(v => v.value);
    durations.sort((a, b) => a - b);

    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);

    const p95Value = durations[p95Index] || 0;
    const p99Value = durations[p99Index] || 0;

    mttrGauge.labels(repository).set(p95Value);
    mttrP99Gauge.labels(repository).set(p99Value);

    // Check SLO compliance (MTTR < 5min p95, < 15min p99)
    const mttrP95Compliant = p95Value <= 300; // 5 minutes
    const mttrP99Compliant = p99Value <= 900; // 15 minutes

    const compliancePercent = mttrP95Compliant && mttrP99Compliant ? 100 : 0;
    recordSLOCompliance('mttr', repository, compliancePercent);

    if (!mttrP95Compliant || !mttrP99Compliant) {
      recordSLOViolation('mttr', repository, 'high');
    }
  }

  logger.info('Calculated SLO metrics', { repository });
}
