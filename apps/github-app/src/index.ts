#!/usr/bin/env node

import dotenv from 'dotenv';
import { SelfHealingCIApp } from './app.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

// Type for environment variables
interface ProcessEnv {
  NODE_ENV?: string;
  GITHUB_APP_ID?: string;
  GITHUB_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  [key: string]: string | undefined;
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    logger.info('Starting Self-Healing CI GitHub App...', {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      env: (process.env as ProcessEnv).NODE_ENV || 'development',
    });

    // Validate required environment variables
    const appId = (process.env as ProcessEnv).GITHUB_APP_ID;
    const privateKey = (process.env as ProcessEnv).GITHUB_PRIVATE_KEY;
    const webhookSecret = (process.env as ProcessEnv).GITHUB_WEBHOOK_SECRET;

    if (!appId || !privateKey || !webhookSecret) {
      throw new Error(
        'Missing required environment variables: GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET'
      );
    }

    // Create and start the application
    const app = new SelfHealingCIApp();
    await app.initializeServices();

    const server = app.getServer();

    // Start the server
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await server.listen({ port, host });

    logger.info('Self-Healing CI GitHub App started successfully', {
      port,
      host,
      appId,
    });

    // Setup graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start Self-Healing CI GitHub App', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    process.exit(1);
  }
}

// Start the application
main().catch(error => {
  logger.error('Unhandled error in main function', {
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
  });

  process.exit(1);
});
