import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

let shared: Redis | null | undefined;

/**
 * Shared Redis connection for workflow state (optional).
 */
export function getSharedRedis(): Redis | null {
  if (shared !== undefined) {
    return shared;
  }
  const url = process.env['REDIS_URL'];
  if (!url) {
    shared = null;
    return null;
  }
  try {
    shared = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    shared.on('error', err => {
      logger.warn('Redis client error', { error: err.message });
    });
  } catch (e) {
    logger.warn('Redis unavailable', {
      error: e instanceof Error ? e.message : String(e),
    });
    shared = null;
  }
  return shared;
}
