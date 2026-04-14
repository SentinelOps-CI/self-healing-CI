import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { logger } from '../utils/logger';

// Initialize OpenTelemetry
const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'self-healing-ci',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
      process.env['NODE_ENV'] || 'development',
  }),
});

// Configure Jaeger exporter
const jaegerExporter = new JaegerExporter({
  endpoint:
    process.env['JAEGER_ENDPOINT'] || 'http://localhost:14268/api/traces',
});

// Add BatchSpanProcessor with Jaeger exporter
provider.addSpanProcessor(new BatchSpanProcessor(jaegerExporter));

// Register the provider
provider.register();

// Get the tracer
const tracer = trace.getTracer('self-healing-ci');

/**
 * Creates a span for an activity
 */
export function createActivitySpan(
  activityName: string,
  attributes: Record<string, string | number | boolean> = {}
) {
  return tracer.startSpan(activityName, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'activity.name': activityName,
      'service.name': 'self-healing-ci',
      ...attributes,
    },
  });
}

/**
 * Wraps an activity with tracing
 */
export function withTracing<T>(
  activityName: string,
  attributes: Record<string, string | number | boolean> = {},
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    activityName,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'activity.name': activityName,
        'service.name': 'self-healing-ci',
        ...attributes,
      },
    },
    async span => {
      const startTime = Date.now();
      try {
        logger.info('Starting activity with tracing', {
          activityName,
          attributes,
        });

        const result = await fn();

        const duration = Date.now() - startTime;
        span.setAttributes({
          'activity.duration_ms': duration,
          'activity.success': true,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        logger.info('Activity completed successfully', {
          activityName,
          duration,
          success: true,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        span.setAttributes({
          'activity.duration_ms': duration,
          'activity.success': false,
          'error.message':
            error instanceof Error ? error.message : String(error),
        });
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });

        logger.error('Activity failed', {
          activityName,
          duration,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Creates a workflow span
 */
export function createWorkflowSpan(
  workflowId: string,
  repository: string,
  workflowRunId: number
) {
  return tracer.startSpan('SelfHealingWorkflow', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'workflow.id': workflowId,
      'workflow.repository': repository,
      'workflow.run_id': workflowRunId,
      'service.name': 'self-healing-ci',
    },
  });
}

/**
 * Records workflow state transition
 */
export function recordWorkflowStateTransition(
  span: any,
  fromState: string,
  toState: string,
  data?: Record<string, unknown>
) {
  span.addEvent('workflow.state.transition', {
    'workflow.state.from': fromState,
    'workflow.state.to': toState,
    'workflow.state.data': JSON.stringify(data || {}),
  });

  logger.info('Workflow state transition', {
    fromState,
    toState,
    data,
  });
}

/**
 * Records diagnosis attempt
 */
export function recordDiagnosisAttempt(
  span: any,
  rootCause: string,
  confidence: number,
  durationMs: number
) {
  span.addEvent('diagnosis.attempt', {
    'diagnosis.root_cause': rootCause,
    'diagnosis.confidence': confidence,
    'diagnosis.duration_ms': durationMs,
  });

  logger.info('Diagnosis attempt recorded', {
    rootCause,
    confidence,
    durationMs,
  });
}

/**
 * Records patch application
 */
export function recordPatchApplication(
  span: any,
  language: string,
  success: boolean,
  durationMs: number,
  safetyLevel?: string
) {
  span.addEvent('patch.application', {
    'patch.language': language,
    'patch.success': success,
    'patch.duration_ms': durationMs,
    'patch.safety_level': safetyLevel || 'unknown',
  });

  logger.info('Patch application recorded', {
    language,
    success,
    durationMs,
    safetyLevel,
  });
}

/**
 * Records test execution
 */
export function recordTestExecution(
  span: any,
  testSuite: string,
  success: boolean,
  durationMs: number,
  flakinessDetected: boolean
) {
  span.addEvent('test.execution', {
    'test.suite': testSuite,
    'test.success': success,
    'test.duration_ms': durationMs,
    'test.flakiness_detected': flakinessDetected,
  });

  logger.info('Test execution recorded', {
    testSuite,
    success,
    durationMs,
    flakinessDetected,
  });
}

/**
 * Records proof validation
 */
export function recordProofValidation(
  span: any,
  proofType: string,
  verdict: string,
  durationMs: number
) {
  span.addEvent('proof.validation', {
    'proof.type': proofType,
    'proof.verdict': verdict,
    'proof.duration_ms': durationMs,
  });

  logger.info('Proof validation recorded', {
    proofType,
    verdict,
    durationMs,
  });
}

/**
 * Records merge operation
 */
export function recordMergeOperation(
  span: any,
  prNumber: number,
  success: boolean,
  durationMs: number,
  branchDeleted: boolean
) {
  span.addEvent('merge.operation', {
    'merge.pr_number': prNumber,
    'merge.success': success,
    'merge.duration_ms': durationMs,
    'merge.branch_deleted': branchDeleted,
  });

  logger.info('Merge operation recorded', {
    prNumber,
    success,
    durationMs,
    branchDeleted,
  });
}

/**
 * Records API call
 */
export function recordAPICall(
  span: any,
  service: string,
  endpoint: string,
  method: string,
  statusCode: number,
  durationMs: number
) {
  span.addEvent('api.call', {
    'api.service': service,
    'api.endpoint': endpoint,
    'api.method': method,
    'api.status_code': statusCode,
    'api.duration_ms': durationMs,
  });

  logger.info('API call recorded', {
    service,
    endpoint,
    method,
    statusCode,
    durationMs,
  });
}

/**
 * Records error
 */
export function recordError(
  span: any,
  errorType: string,
  errorMessage: string,
  activity: string
) {
  span.addEvent('error.occurred', {
    'error.type': errorType,
    'error.message': errorMessage,
    'error.activity': activity,
  });

  logger.error('Error recorded', {
    errorType,
    errorMessage,
    activity,
  });
}

/**
 * Records SLO violation
 */
export function recordSLOViolation(
  span: any,
  sloName: string,
  severity: string,
  details: Record<string, unknown>
) {
  span.addEvent('slo.violation', {
    'slo.name': sloName,
    'slo.severity': severity,
    'slo.details': JSON.stringify(details),
  });

  logger.warn('SLO violation recorded', {
    sloName,
    severity,
    details,
  });
}

/**
 * Creates a child span for sub-operations
 */
export function createChildSpan(
  _parentSpan: unknown,
  operationName: string,
  attributes: Record<string, string | number | boolean> = {}
) {
  return tracer.startSpan(
    operationName,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        ...attributes,
      },
    },
    context.active()
  );
}

/**
 * Adds custom attributes to a span
 */
export function addSpanAttributes(
  span: any,
  attributes: Record<string, string | number | boolean>
) {
  span.setAttributes(attributes);
}

/**
 * Records a custom event on a span
 */
export function recordSpanEvent(
  span: any,
  eventName: string,
  attributes: Record<string, string | number | boolean> = {}
) {
  span.addEvent(eventName, attributes);
}

/**
 * Sets span status
 */
export function setSpanStatus(span: any, success: boolean, message?: string) {
  if (success) {
    span.setStatus({ code: SpanStatusCode.OK });
  } else {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: message || 'Operation failed',
    });
  }
}

/**
 * Creates a span for external service calls
 */
export function createExternalServiceSpan(
  serviceName: string,
  operation: string,
  attributes: Record<string, string | number | boolean> = {}
) {
  return tracer.startSpan(`${serviceName}.${operation}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'service.name': serviceName,
      'service.operation': operation,
      ...attributes,
    },
  });
}

/**
 * Wraps external service calls with tracing
 */
export function withExternalServiceTracing<T>(
  serviceName: string,
  operation: string,
  attributes: Record<string, string | number | boolean> = {},
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    `${serviceName}.${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'service.name': serviceName,
        'service.operation': operation,
        ...attributes,
      },
    },
    async span => {
      const startTime = Date.now();
      try {
        logger.info('Starting external service call', {
          serviceName,
          operation,
          attributes,
        });

        const result = await fn();

        const duration = Date.now() - startTime;
        span.setAttributes({
          'service.duration_ms': duration,
          'service.success': true,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        logger.info('External service call completed', {
          serviceName,
          operation,
          duration,
          success: true,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        span.setAttributes({
          'service.duration_ms': duration,
          'service.success': false,
          'error.message':
            error instanceof Error ? error.message : String(error),
          'error.type':
            error instanceof Error ? error.constructor.name : 'Unknown',
        });
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });

        logger.error('External service call failed', {
          serviceName,
          operation,
          duration,
          error: error instanceof Error ? error.message : String(error),
          success: false,
        });

        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Shuts down the tracing provider
 */
export async function shutdownTracing(): Promise<void> {
  try {
    await provider.shutdown();
    logger.info('Tracing provider shut down successfully');
  } catch (error) {
    logger.error('Failed to shut down tracing provider', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
