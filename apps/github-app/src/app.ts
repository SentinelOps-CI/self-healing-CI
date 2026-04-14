import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Context, Probot } from 'probot';
import { DeduplicationService } from './services/deduplication.js';
import { workflowNameMatchesAllowlist } from './services/self-healing-policy.js';
import { TemporalClient } from './services/temporal.js';
import type { WorkflowRunEvent } from './types/workflow-run.js';
import { logger } from './utils/logger.js';

// Type for environment variables
interface ProcessEnv {
  NODE_ENV?: string;
  npm_package_version?: string;
  [key: string]: string | undefined;
}

export class SelfHealingCIApp {
  private app: Probot;
  private server: FastifyInstance;
  private deduplicationService: DeduplicationService;
  private temporalService: TemporalClient;

  constructor() {
    this.app = new Probot({
      appId: (process.env as ProcessEnv)['GITHUB_APP_ID'] || '',
      privateKey: (process.env as ProcessEnv)['GITHUB_PRIVATE_KEY'] || '',
      secret: (process.env as ProcessEnv)['GITHUB_WEBHOOK_SECRET'] || '',
    });

    // Get the server from probot
    this.server = (this.app as any).server as FastifyInstance;
    this.deduplicationService = new DeduplicationService();
    this.temporalService = new TemporalClient();

    this.setupEventHandlers();
    this.setupHealthEndpoints();
  }

  /**
   * Connect Redis, DynamoDB (if configured), and Temporal before serving traffic.
   */
  async initializeServices(): Promise<void> {
    await this.deduplicationService.initialize().catch(err => {
      logger.warn('Deduplication initialize failed (continuing)', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    await this.temporalService.initialize().catch(err => {
      logger.warn('Temporal initialize failed (workflows unavailable)', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private setupEventHandlers(): void {
    // Handle workflow_run events
    this.app.on('workflow_run', async (context: Context<'workflow_run'>) => {
      try {
        const workflowRunEvent = context.payload as unknown as WorkflowRunEvent;

        logger.info('Received workflow_run event', {
          repository: workflowRunEvent.repository.full_name,
          workflowRunId: workflowRunEvent.workflow_run.id,
          status: workflowRunEvent.workflow_run.status,
          conclusion: workflowRunEvent.workflow_run.conclusion,
        });

        // Check if this is a failure that needs self-healing
        if (this.shouldTriggerSelfHealing(workflowRunEvent)) {
          await this.handleWorkflowFailure(workflowRunEvent);
        }
      } catch (error) {
        logger.error('Error handling workflow_run event', {
          error: error instanceof Error ? error.message : 'Unknown error',
          repository: context.payload.repository?.full_name,
        });
      }
    });

    // Handle installation events
    this.app.on(
      'installation.created',
      async (context: Context<'installation.created'>) => {
        logger.info('GitHub App installed', {
          installationId: context.payload.installation.id,
          account: context.payload.installation.account.login,
        });
      }
    );

    this.app.on(
      'installation.deleted',
      async (context: Context<'installation.deleted'>) => {
        logger.info('GitHub App uninstalled', {
          installationId: context.payload.installation.id,
          account: context.payload.installation.account.login,
        });
      }
    );

    this.app.on(
      'repository.created',
      async (context: Context<'repository.created'>) => {
        logger.info('Repository created', {
          repository: context.payload.repository.full_name,
          owner: context.payload.repository.owner.login,
        });
      }
    );

    // Handle errors
    this.app.onError(async (error: Error) => {
      logger.error('Probot app error', {
        error: error.message,
        stack: error.stack,
      });
    });
  }

  private setupHealthEndpoints(): void {
    // Health check endpoint
    this.server.get(
      '/health',
      async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
          const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version:
              (process.env as ProcessEnv)['npm_package_version'] ||
              '0.0.0-development',
            services: {
              deduplication: await this.deduplicationService.isHealthy(),
              temporal: await this.temporalService.isHealthy(),
            },
          };

          return reply.status(200).send(health);
        } catch (error) {
          logger.error('Health check failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          return reply.status(503).send({
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    );

    // Readiness check endpoint
    this.server.get(
      '/ready',
      async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
          const ready = {
            status: 'ready',
            timestamp: new Date().toISOString(),
            services: {
              deduplication: await this.deduplicationService.isReady(),
              temporal: await this.temporalService.isReady(),
            },
          };

          return reply.status(200).send(ready);
        } catch (error) {
          logger.error('Readiness check failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          return reply.status(503).send({
            status: 'not ready',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    );

    // Metrics endpoint
    this.server.get(
      '/metrics',
      async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
          const metrics = {
            timestamp: new Date().toISOString(),
            version:
              (process.env as ProcessEnv)['npm_package_version'] ||
              '0.0.0-development',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            deduplication: await this.deduplicationService.getMetrics(),
            temporal: await this.temporalService.getMetrics(),
          };

          return reply.status(200).send(metrics);
        } catch (error) {
          logger.error('Metrics collection failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          return reply.status(500).send({
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    );
  }

  private shouldTriggerSelfHealing(event: WorkflowRunEvent): boolean {
    const workflowRun = event.workflow_run;

    // Only trigger on failed workflow runs
    if (workflowRun.conclusion !== 'failure') {
      return false;
    }

    // Check if this is a recent failure (within last 24 hours)
    const runTime = new Date(workflowRun.created_at).getTime();
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (now - runTime > twentyFourHours) {
      return false;
    }

    return workflowNameMatchesAllowlist(workflowRun.name);
  }

  private async handleWorkflowFailure(event: WorkflowRunEvent): Promise<void> {
    try {
      const workflowRun = event.workflow_run;
      const repository = event.repository;

      if (process.env['SELF_HEALING_ENABLED'] === 'false') {
        logger.info('Self-healing disabled via SELF_HEALING_ENABLED', {
          repository: repository.full_name,
        });
        return;
      }

      logger.info('Triggering self-healing for workflow failure', {
        repository: repository.full_name,
        workflowRunId: workflowRun.id,
        workflowName: workflowRun.name,
        headSha: workflowRun.head_sha,
      });

      const isDuplicate = await this.deduplicationService.isDuplicate(
        repository.full_name,
        workflowRun.id,
        workflowRun.head_sha
      );

      if (isDuplicate) {
        logger.info('Skipping duplicate workflow failure', {
          repository: repository.full_name,
          workflowRunId: workflowRun.id,
        });
        return;
      }

      const maxPerDay = parseInt(
        process.env['SELF_HEALING_MAX_RUNS_PER_DAY'] || '20',
        10
      );
      const budgetOk = await this.deduplicationService.consumeSelfHealingBudget(
        repository.full_name,
        maxPerDay
      );
      if (!budgetOk) {
        logger.info('Self-healing skipped: daily budget exceeded', {
          repository: repository.full_name,
        });
        return;
      }

      // Start self-healing workflow
      await this.temporalService.startSelfHealingWorkflow({
        repository: repository.full_name,
        workflowRunId: workflowRun.id,
        headSha: workflowRun.head_sha,
        branch: workflowRun.head_branch,
        installationId: event.installation?.id || 0,
        actor: event.sender.login,
      });

      logger.info('Self-healing workflow started', {
        repository: repository.full_name,
        workflowRunId: workflowRun.id,
      });
    } catch (error) {
      logger.error('Failed to handle workflow failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
        repository: event.repository.full_name,
        workflowRunId: event.workflow_run.id,
      });
    }
  }

  public getApp(): Probot {
    return this.app;
  }

  public getServer(): FastifyInstance {
    return this.server;
  }
}
