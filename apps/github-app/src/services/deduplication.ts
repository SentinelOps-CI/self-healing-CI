import { DynamoDB } from 'aws-sdk';
import Redis from 'ioredis';
import type { WorkflowRunEvent } from '../types/workflow-run.js';
import { getWorkflowRunId } from '../types/workflow-run.js';
import { logger } from '../utils/logger.js';

export interface DeduplicationConfig {
  redisUrl?: string;
  dynamoTableName?: string;
  awsRegion?: string;
  ttlSeconds?: number;
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  workflowRunId: string;
  timestamp: Date;
  ttl: number;
}

export class DeduplicationService {
  private redis: Redis | null = null;
  private dynamoDb: DynamoDB.DocumentClient | null = null;
  private readonly config: Required<DeduplicationConfig>;
  private readonly ttlSeconds: number;

  constructor(config: DeduplicationConfig = {}) {
    this.config = {
      redisUrl:
        config.redisUrl || process.env['REDIS_URL'] || 'redis://localhost:6379',
      dynamoTableName:
        config.dynamoTableName ||
        process.env['DYNAMODB_TABLE'] ||
        'self-healing-ci-dedup',
      awsRegion: config.awsRegion || process.env['AWS_REGION'] || 'us-east-1',
      ttlSeconds: config.ttlSeconds || 3600, // 1 hour default
    };
    this.ttlSeconds = this.config.ttlSeconds;
  }

  /**
   * Initialize the deduplication service with Redis and DynamoDB connections
   */
  async initialize(): Promise<void> {
    try {
      // Initialize Redis connection
      this.redis = new Redis(this.config.redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
        enableReadyCheck: true,
        enableOfflineQueue: false,
      });

      this.redis.on('error', error => {
        logger.error('Redis connection error:', error);
      });

      this.redis.on('connect', () => {
        logger.info('Redis connected successfully');
      });

      // Initialize DynamoDB connection
      this.dynamoDb = new DynamoDB.DocumentClient({
        region: this.config.awsRegion,
        maxRetries: 3,
        httpOptions: {
          timeout: 5000,
          connectTimeout: 3000,
        },
      });

      // Test connections
      await this.testConnections();

      logger.info('Deduplication service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize deduplication service:', error);
      throw new Error(
        `Deduplication service initialization failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Test both Redis and DynamoDB connections
   */
  private async testConnections(): Promise<void> {
    const promises: Promise<void>[] = [];

    // Test Redis
    if (this.redis) {
      promises.push(
        this.redis.ping().then(() => {
          logger.info('Redis connection test successful');
        })
      );
    }

    // Test DynamoDB
    if (this.dynamoDb) {
      promises.push(
        this.dynamoDb
          .get({
            TableName: this.config.dynamoTableName,
            Key: { workflowRunId: 'test' },
          })
          .promise()
          .then(() => {
            logger.info('DynamoDB connection test successful');
          })
          .catch(() => {
            // It's okay if the test key doesn't exist
            logger.info('DynamoDB connection test successful');
          })
      );
    }

    await Promise.all(promises);
  }

  /**
   * Check if a workflow run event is a duplicate and store it if not
   */
  async checkAndStore(event: WorkflowRunEvent): Promise<DeduplicationResult> {
    const workflowRunId = getWorkflowRunId(event);
    const timestamp = new Date();
    const ttl = Math.floor(timestamp.getTime() / 1000) + this.ttlSeconds;

    try {
      // Try Redis first (faster)
      const redisResult = await this.checkRedis(workflowRunId);
      if (redisResult !== null) {
        return redisResult;
      }

      // Fallback to DynamoDB
      const dynamoResult = await this.checkDynamoDB(workflowRunId);
      if (dynamoResult !== null) {
        return dynamoResult;
      }

      // If not found in either, store in both
      await this.storeInBoth(workflowRunId, timestamp, ttl);

      return {
        isDuplicate: false,
        workflowRunId,
        timestamp,
        ttl,
      };
    } catch (error) {
      logger.error('Deduplication check failed:', error);
      // In case of error, assume it's not a duplicate to avoid blocking legitimate events
      return {
        isDuplicate: false,
        workflowRunId,
        timestamp,
        ttl,
      };
    }
  }

  /**
   * Check Redis for existing workflow run
   */
  private async checkRedis(
    workflowRunId: string
  ): Promise<DeduplicationResult | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const key = `workflow_run:${workflowRunId}`;
      const existing = await this.redis.get(key);

      if (existing) {
        const existingData = JSON.parse(existing);
        return {
          isDuplicate: true,
          workflowRunId,
          timestamp: new Date(existingData.timestamp),
          ttl: existingData.ttl,
        };
      }

      return null;
    } catch (error) {
      logger.warn('Redis check failed, falling back to DynamoDB:', error);
      return null;
    }
  }

  /**
   * Check DynamoDB for existing workflow run
   */
  private async checkDynamoDB(
    workflowRunId: string
  ): Promise<DeduplicationResult | null> {
    if (!this.dynamoDb) {
      return null;
    }

    try {
      const params: DynamoDB.DocumentClient.GetItemInput = {
        TableName: this.config.dynamoTableName,
        Key: {
          workflowRunId,
        },
      };

      const result = await this.dynamoDb.get(params).promise();

      if (result.Item) {
        return {
          isDuplicate: true,
          workflowRunId,
          timestamp: new Date(result.Item['timestamp']),
          ttl: result.Item['ttl'],
        };
      }

      return null;
    } catch (error) {
      logger.warn('DynamoDB check failed:', error);
      return null;
    }
  }

  /**
   * Store workflow run in both Redis and DynamoDB
   */
  private async storeInBoth(
    workflowRunId: string,
    timestamp: Date,
    ttl: number
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    // Store in Redis
    if (this.redis) {
      promises.push(
        this.storeInRedis(workflowRunId, timestamp, ttl).catch(error => {
          logger.warn('Failed to store in Redis:', error);
        })
      );
    }

    // Store in DynamoDB
    if (this.dynamoDb) {
      promises.push(
        this.storeInDynamoDB(workflowRunId, timestamp, ttl).catch(error => {
          logger.warn('Failed to store in DynamoDB:', error);
        })
      );
    }

    await Promise.all(promises);
  }

  /**
   * Store workflow run in Redis
   */
  private async storeInRedis(
    workflowRunId: string,
    timestamp: Date,
    ttl: number
  ): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis not initialized');
    }

    const key = `workflow_run:${workflowRunId}`;
    const value = JSON.stringify({
      timestamp: timestamp.toISOString(),
      ttl,
    });

    await this.redis.setex(key, this.ttlSeconds, value);
  }

  /**
   * Store workflow run in DynamoDB
   */
  private async storeInDynamoDB(
    workflowRunId: string,
    timestamp: Date,
    ttl: number
  ): Promise<void> {
    if (!this.dynamoDb) {
      throw new Error('DynamoDB not initialized');
    }

    const params: DynamoDB.DocumentClient.PutItemInput = {
      TableName: this.config.dynamoTableName,
      Item: {
        workflowRunId,
        timestamp: timestamp.toISOString(),
        ttl,
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(workflowRunId)',
    };

    await this.dynamoDb.put(params).promise();
  }

  /**
   * Clean up expired entries
   */
  async cleanup(): Promise<void> {
    try {
      // Redis cleanup is automatic with TTL
      if (this.redis) {
        await this.redis.eval(
          `
          local keys = redis.call('keys', 'workflow_run:*')
          local now = redis.call('time')[1]
          local deleted = 0
          for i, key in ipairs(keys) do
            local ttl = redis.call('ttl', key)
            if ttl == -1 or ttl > ${this.ttlSeconds} then
              redis.call('del', key)
              deleted = deleted + 1
            end
          end
          return deleted
        `,
          0
        );
      }

      // DynamoDB cleanup (TTL is handled automatically by DynamoDB)
      logger.info('Cleanup completed');
    } catch (error) {
      logger.warn('Cleanup failed:', error);
    }
  }

  /**
   * Get statistics about the deduplication service
   */
  async getStats(): Promise<{
    redisConnected: boolean;
    dynamoConnected: boolean;
    totalEntries: number;
  }> {
    let redisConnected = false;
    let dynamoConnected = false;
    let totalEntries = 0;

    try {
      if (this.redis) {
        await this.redis.ping();
        redisConnected = true;
        const keys = await this.redis.keys('workflow_run:*');
        totalEntries += keys.length;
      }
    } catch (error) {
      logger.warn('Redis stats check failed:', error);
    }

    try {
      if (this.dynamoDb) {
        // Test connection by trying to get a non-existent item
        await this.dynamoDb
          .get({
            TableName: this.config.dynamoTableName,
            Key: { workflowRunId: 'test-connection' },
          })
          .promise();
        dynamoConnected = true;
        // Note: We can't easily count items without a scan, which is expensive
        // For now, we'll just check if the table is accessible
      }
    } catch (error) {
      logger.warn('DynamoDB stats check failed:', error);
    }

    return {
      redisConnected,
      dynamoConnected,
      totalEntries,
    };
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.redis) {
      promises.push(this.redis.quit().then(() => undefined));
    }

    // DynamoDB doesn't need explicit closing

    await Promise.all(promises);
    logger.info('Deduplication service connections closed');
  }

  /**
   * Enforce a per-repository daily cap on self-healing workflow starts.
   */
  async consumeSelfHealingBudget(
    repositoryFullName: string,
    maxPerDay: number
  ): Promise<boolean> {
    if (!this.redis) {
      try {
        await this.initialize();
      } catch {
        return true;
      }
    }
    if (!this.redis) {
      return true;
    }

    const day = new Date().toISOString().slice(0, 10);
    const key = `self_heal_budget:${repositoryFullName}:${day}`;
    const n = await this.redis.incr(key);
    if (n === 1) {
      await this.redis.expire(key, 172800);
    }
    if (n > maxPerDay) {
      logger.warn('Self-healing daily budget exceeded', {
        repositoryFullName,
        count: n,
        maxPerDay,
      });
      return false;
    }
    return true;
  }

  /**
   * Check if a workflow run is a duplicate
   */
  async isDuplicate(
    repository: string,
    workflowRunId: number,
    headSha: string
  ): Promise<boolean> {
    const eventId = `${repository}:${workflowRunId}:${headSha}`;

    try {
      // Try Redis first (faster)
      if (this.redis) {
        const key = `workflow_run:${eventId}`;
        const existing = await this.redis.get(key);
        if (existing) {
          return true;
        }
      }

      // Fallback to DynamoDB
      if (this.dynamoDb) {
        const params: DynamoDB.DocumentClient.GetItemInput = {
          TableName: this.config.dynamoTableName,
          Key: {
            workflowRunId: eventId,
          },
        };

        const result = await this.dynamoDb.get(params).promise();
        if (result.Item) {
          return true;
        }
      }

      // If not found, store it
      await this.storeEvent(eventId);
      return false;
    } catch (error) {
      logger.error('Deduplication check failed:', error);
      // In case of error, assume it's not a duplicate to avoid blocking legitimate events
      return false;
    }
  }

  /**
   * Store an event for deduplication
   */
  private async storeEvent(eventId: string): Promise<void> {
    const timestamp = new Date();
    const ttl = Math.floor(timestamp.getTime() / 1000) + this.ttlSeconds;

    const promises: Promise<void>[] = [];

    // Store in Redis
    if (this.redis) {
      promises.push(
        this.storeInRedis(eventId, timestamp, ttl).catch(error => {
          logger.warn('Failed to store in Redis:', error);
        })
      );
    }

    // Store in DynamoDB
    if (this.dynamoDb) {
      promises.push(
        this.storeInDynamoDB(eventId, timestamp, ttl).catch(error => {
          logger.warn('Failed to store in DynamoDB:', error);
        })
      );
    }

    await Promise.all(promises);
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const stats = await this.getStats();
      return stats.redisConnected || stats.dynamoConnected;
    } catch (error) {
      logger.warn('Health check failed:', error);
      return false;
    }
  }

  /**
   * Check if the service is ready
   */
  async isReady(): Promise<boolean> {
    try {
      const stats = await this.getStats();
      return stats.redisConnected && stats.dynamoConnected;
    } catch (error) {
      logger.warn('Readiness check failed:', error);
      return false;
    }
  }

  /**
   * Get service metrics
   */
  async getMetrics(): Promise<{
    redisConnected: boolean;
    dynamoConnected: boolean;
    totalEntries: number;
    lastError?: string;
  }> {
    try {
      const stats = await this.getStats();
      return {
        ...stats,
      };
    } catch (error) {
      return {
        redisConnected: false,
        dynamoConnected: false,
        totalEntries: 0,
        lastError: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Export singleton instance
export const deduplicationService = new DeduplicationService();
