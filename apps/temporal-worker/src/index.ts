#!/usr/bin/env node

import { Worker } from '@temporalio/worker';
import dotenv from 'dotenv';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as activities from './activities/index.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

// Type for environment variables
interface ProcessEnv {
  NODE_ENV?: string;
  TEMPORAL_TASK_QUEUE?: string;
  TEMPORAL_NAMESPACE?: string;
  [key: string]: string | undefined;
}

/**
 * Main Temporal worker entry point
 */
async function main(): Promise<void> {
  try {
    const env = process.env as ProcessEnv;

    logger.info('Starting Temporal Worker...', {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      env: env.NODE_ENV || 'development',
    });

    // Create worker
    const worker = await Worker.create({
      workflowsPath: new URL('./workflows/index.js', import.meta.url).pathname,
      activities,
      taskQueue: env.TEMPORAL_TASK_QUEUE || 'self-healing-ci',
      namespace: env.TEMPORAL_NAMESPACE || 'default',
      maxConcurrentActivityTaskExecutions: 10,
      maxConcurrentWorkflowTaskExecutions: 50,
      maxCachedWorkflows: 100,
    });

    // Setup global error handlers
    setupGlobalErrorHandlers();

    // Start the worker
    await worker.run();

    logger.info('Temporal Worker started successfully');

    // Keep the process alive
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await worker.shutdown();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await worker.shutdown();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start Temporal Worker', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    process.exit(1);
  }
}

/**
 * Setup global error handlers
 */
function setupGlobalErrorHandlers(): void {
  // Handle uncaught exceptions
  process.on('uncaughtException', error => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
    });

    // Give time for logs to be written before exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise.toString(),
    });

    // Give time for logs to be written before exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle process warnings
  process.on('warning', warning => {
    logger.warn('Process Warning', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });

  // Handle process exit
  process.on('exit', code => {
    logger.info('Process exiting', {
      code,
      uptime: process.uptime(),
    });
  });
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): void {
  const requiredEnvVars = ['TEMPORAL_TASK_QUEUE', 'TEMPORAL_NAMESPACE'];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    logger.warn(
      `Missing Temporal environment variables: ${missingVars.join(', ')}`
    );
  }

  logger.info('Environment validation passed');
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  validateEnvironment();

  main().catch(error => {
    logger.error('Worker failed to start', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    process.exit(1);
  });
}

export default main;
