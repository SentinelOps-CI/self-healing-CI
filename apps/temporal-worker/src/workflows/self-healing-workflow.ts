import { log, proxyActivities, workflowInfo } from '@temporalio/workflow';
import type * as activities from '../activities/index.js';

// Define workflow state enum
export enum WorkflowState {
  NEW = 'NEW',
  DIAGNOSE = 'DIAGNOSE',
  PATCH = 'PATCH',
  TEST = 'TEST',
  PROVE = 'PROVE',
  MERGE = 'MERGE',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

// Define root cause enum
export enum RootCause {
  DEP_UPGRADE = 'DEP_UPGRADE',
  API_CHANGE = 'API_CHANGE',
  FLAKY_TEST = 'FLAKY_TEST',
  CONFIG_ERROR = 'CONFIG_ERROR',
  ENV_ISSUE = 'ENV_ISSUE',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN',
}

/** Workflow input (matches github-app Temporal client). */
export interface SelfHealingWorkflowInput {
  repository: string;
  workflowRunId: number;
  headSha: string;
  branch: string;
  actor: string;
  installationId: number;
}

// Define workflow state interface
export interface WorkflowStateData {
  state: WorkflowState;
  timestamp: string;
  data?: Record<string, unknown>;
  error?: string;
}

// Define workflow result interface
export interface WorkflowResult {
  success: boolean;
  state: WorkflowState;
  rootCause?: RootCause;
  patchApplied?: boolean;
  testsPassed?: boolean;
  proofsValidated?: boolean;
  merged?: boolean;
  error?: string;
  duration: number;
  metadata: Record<string, unknown>;
}

const retryPolicy = {
  initialInterval: '1s' as const,
  maximumInterval: '1m' as const,
  maximumAttempts: 3,
  backoffCoefficient: 2,
};

const { collectFailureData } = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',
  retry: retryPolicy,
});

const {
  diagnoseFailure,
  applyPatch,
  runTests,
  validateProofs,
  mergeChanges,
  emitCloudEvent,
  updateWorkflowStatus,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: retryPolicy,
});

/**
 * Main self-healing workflow implementation
 */
export async function SelfHealingWorkflow(
  input: SelfHealingWorkflowInput
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const workflowId = workflowInfo().workflowId;
  const healingBranch = `self-healing-ci/${input.workflowRunId}-${input.headSha.substring(0, 7)}`;

  log.info('Starting Self-Healing Workflow', {
    workflowId,
    repository: input.repository,
    workflowRunId: input.workflowRunId,
    headSha: input.headSha,
  });

  let currentState: WorkflowState = WorkflowState.NEW;
  let rootCause: RootCause | undefined;
  let patchApplied = false;
  let testsPassed = false;
  let proofsValidated = false;
  let merged = false;
  let error: string | undefined;

  const statusBase = {
    repository: input.repository,
    commitSha: input.headSha,
    installationId: input.installationId,
  };

  try {
    await updateWorkflowStatus({
      workflowId,
      state: WorkflowState.NEW,
      timestamp: new Date().toISOString(),
      data: { input },
      ...statusBase,
    });

    log.info('Workflow state: NEW', { workflowId });

    const collected = await collectFailureData({
      repository: input.repository,
      workflowRunId: input.workflowRunId,
      headSha: input.headSha,
      branch: input.branch,
      installationId: input.installationId,
    });

    const failureData = collected.failureData;

    currentState = WorkflowState.DIAGNOSE;
    await updateWorkflowStatus({
      workflowId,
      state: currentState,
      timestamp: new Date().toISOString(),
      ...statusBase,
    });

    log.info('Workflow state: DIAGNOSE', { workflowId });

    await emitCloudEvent({
      eventType: 'workflow.state.diagnose',
      source: 'self-healing-ci',
      subject: 'self-healing-ci',
      eventData: {
        workflowId,
        state: currentState,
        repository: input.repository,
        workflowRunId: input.workflowRunId,
        timestamp: new Date().toISOString(),
      },
    });

    const diagnosisResult = await diagnoseFailure({
      repository: input.repository,
      workflowRunId: input.workflowRunId,
      headSha: input.headSha,
      branch: input.branch,
      installationId: input.installationId,
      actor: input.actor,
      failureData,
    });
    rootCause = diagnosisResult.rootCause;

    log.info('Diagnosis completed', {
      workflowId,
      rootCause,
      confidence: diagnosisResult.confidence,
    });

    currentState = WorkflowState.PATCH;
    await updateWorkflowStatus({
      workflowId,
      state: currentState,
      timestamp: new Date().toISOString(),
      data: { diagnosisResult },
      ...statusBase,
    });

    log.info('Workflow state: PATCH', { workflowId });

    await emitCloudEvent({
      eventType: 'workflow.state.patch',
      source: 'self-healing-ci',
      subject: 'self-healing-ci',
      eventData: {
        workflowId,
        state: currentState,
        repository: input.repository,
        workflowRunId: input.workflowRunId,
        rootCause,
        timestamp: new Date().toISOString(),
      },
    });

    if (
      diagnosisResult.rootCause !== RootCause.UNKNOWN &&
      diagnosisResult.patch
    ) {
      const patchResult = await applyPatch({
        repository: input.repository,
        headSha: input.headSha,
        branch: input.branch,
        patch: diagnosisResult.patch,
        rootCause: diagnosisResult.rootCause,
        installationId: input.installationId,
        workflowRunId: input.workflowRunId,
      });

      patchApplied = patchResult.success;

      if (!patchApplied) {
        throw new Error(`Failed to apply patch: ${patchResult.error}`);
      }

      log.info('Patch applied successfully', {
        workflowId,
        patchSha: patchResult.patchSha,
        filesChanged: patchResult.filesChanged,
      });
    } else {
      log.info('No patch to apply', { workflowId, rootCause });
    }

    currentState = WorkflowState.TEST;
    await updateWorkflowStatus({
      workflowId,
      state: currentState,
      timestamp: new Date().toISOString(),
      data: { patchApplied },
      ...statusBase,
    });

    log.info('Workflow state: TEST', { workflowId });

    await emitCloudEvent({
      eventType: 'workflow.state.test',
      source: 'self-healing-ci',
      subject: 'self-healing-ci',
      eventData: {
        workflowId,
        state: currentState,
        repository: input.repository,
        workflowRunId: input.workflowRunId,
        patchApplied,
        timestamp: new Date().toISOString(),
      },
    });

    const testResult = await runTests({
      repository: input.repository,
      headSha: input.headSha,
      branch: input.branch,
    });

    testsPassed = testResult.success;

    if (!testsPassed) {
      log.warn('Tests failed after patch', {
        workflowId,
        testError: testResult.error,
        testOutput: testResult.output,
      });

      if (testResult.retryDiagnosis) {
        log.info('Retrying diagnosis due to test failure', { workflowId });

        currentState = WorkflowState.DIAGNOSE;
        await updateWorkflowStatus({
          workflowId,
          state: currentState,
          timestamp: new Date().toISOString(),
          data: { testFailure: testResult },
          ...statusBase,
        });

        const retryDiagnosisResult = await diagnoseFailure({
          repository: input.repository,
          workflowRunId: input.workflowRunId,
          headSha: input.headSha,
          branch: input.branch,
          installationId: input.installationId,
          actor: input.actor,
          failureData,
          testFailure: testResult,
        });

        if (
          retryDiagnosisResult.rootCause !== RootCause.UNKNOWN &&
          retryDiagnosisResult.patch
        ) {
          const retryPatchResult = await applyPatch({
            repository: input.repository,
            headSha: input.headSha,
            branch: input.branch,
            patch: retryDiagnosisResult.patch,
            rootCause: retryDiagnosisResult.rootCause,
            installationId: input.installationId,
            workflowRunId: input.workflowRunId,
          });

          if (retryPatchResult.success) {
            const retryTestResult = await runTests({
              repository: input.repository,
              headSha: input.headSha,
              branch: input.branch,
            });

            testsPassed = retryTestResult.success;
          }
        }
      }
    } else {
      log.info('Tests passed after patch', { workflowId });
    }

    currentState = WorkflowState.PROVE;
    await updateWorkflowStatus({
      workflowId,
      state: currentState,
      timestamp: new Date().toISOString(),
      data: { testsPassed },
      ...statusBase,
    });

    log.info('Workflow state: PROVE', { workflowId });

    await emitCloudEvent({
      eventType: 'workflow.state.prove',
      source: 'self-healing-ci',
      subject: 'self-healing-ci',
      eventData: {
        workflowId,
        state: currentState,
        repository: input.repository,
        workflowRunId: input.workflowRunId,
        testsPassed,
        timestamp: new Date().toISOString(),
      },
    });

    if (testsPassed) {
      const proofResult = await validateProofs({
        repository: input.repository,
        headSha: input.headSha,
        branch: input.branch,
        proofFiles: [],
      });

      proofsValidated = proofResult.success;

      if (!proofsValidated) {
        log.warn('Proofs validation failed', {
          workflowId,
          proofError: proofResult.error,
        });
      } else {
        log.info('Proofs validated successfully', { workflowId });
      }
    } else {
      log.info('Skipping proofs validation due to test failure', {
        workflowId,
      });
    }

    currentState = WorkflowState.MERGE;
    await updateWorkflowStatus({
      workflowId,
      state: currentState,
      timestamp: new Date().toISOString(),
      data: { testsPassed, proofsValidated },
      ...statusBase,
    });

    log.info('Workflow state: MERGE', { workflowId });

    await emitCloudEvent({
      eventType: 'workflow.state.merge',
      source: 'self-healing-ci',
      subject: 'self-healing-ci',
      eventData: {
        workflowId,
        state: currentState,
        repository: input.repository,
        workflowRunId: input.workflowRunId,
        testsPassed,
        proofsValidated,
        timestamp: new Date().toISOString(),
      },
    });

    if (testsPassed && proofsValidated) {
      const mergeResult = await mergeChanges({
        repository: input.repository,
        installationId: input.installationId,
        baseBranch: input.branch,
        headBranch: healingBranch,
        title: `fix(ci): self-healing for ${rootCause || 'unknown issue'}`,
        body: `Automated fix from Self-Healing CI.\n\n- Root cause: ${String(rootCause)}\n- Patch applied: ${patchApplied}\n- Tests passed: ${testsPassed}\n- Proofs: ${proofsValidated}`,
      });

      if (!mergeResult.success) {
        throw new Error(
          `Failed to merge changes: ${mergeResult.error || 'unknown'}`
        );
      }

      merged = mergeResult.merged === true;

      log.info('Merge step finished', {
        workflowId,
        mergeCommitSha: mergeResult.mergeCommitSha,
        prNumber: mergeResult.prNumber,
        skipped: mergeResult.skipped,
        merged,
      });
    } else {
      log.info('Skipping merge due to test or proof failure', {
        workflowId,
        testsPassed,
        proofsValidated,
      });
    }

    currentState = WorkflowState.DONE;
    await updateWorkflowStatus({
      workflowId,
      state: currentState,
      timestamp: new Date().toISOString(),
      data: { testsPassed, proofsValidated, merged },
      ...statusBase,
    });

    log.info('Workflow state: DONE', { workflowId });

    await emitCloudEvent({
      eventType: 'workflow.state.done',
      source: 'self-healing-ci',
      subject: 'self-healing-ci',
      eventData: {
        workflowId,
        state: currentState,
        repository: input.repository,
        workflowRunId: input.workflowRunId,
        testsPassed,
        proofsValidated,
        merged,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    currentState = WorkflowState.FAILED;
    error = err instanceof Error ? err.message : 'Unknown error';

    await updateWorkflowStatus({
      workflowId,
      state: currentState,
      timestamp: new Date().toISOString(),
      data: { error },
      ...statusBase,
    });

    log.error('Workflow failed', {
      workflowId,
      error,
      state: currentState,
    });

    await emitCloudEvent({
      eventType: 'workflow.state.failed',
      source: 'self-healing-ci',
      subject: 'self-healing-ci',
      eventData: {
        workflowId,
        state: currentState,
        repository: input.repository,
        workflowRunId: input.workflowRunId,
        error,
        timestamp: new Date().toISOString(),
      },
    });
  }

  const duration = Date.now() - startTime;

  const result: WorkflowResult = {
    success: currentState === WorkflowState.DONE,
    state: currentState,
    rootCause,
    patchApplied,
    testsPassed,
    proofsValidated,
    merged,
    error,
    duration,
    metadata: {
      workflowId,
      repository: input.repository,
      workflowRunId: input.workflowRunId,
      headSha: input.headSha,
      branch: input.branch,
      actor: input.actor,
      installationId: input.installationId,
    },
  };

  log.info('Self-Healing Workflow completed', {
    workflowId,
    result,
  });

  return result;
}
