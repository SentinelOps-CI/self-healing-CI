import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Create logger instance
export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'temporal-worker' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    // File transport for errors
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
    }),
    // File transport for all logs
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
});

// Create a stream object for Morgan
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

// Export log levels
export const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

// Helper function for structured logging
export function logError(
  error: Error,
  context?: Record<string, unknown>
): void {
  logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    ...context,
  });
}

// Helper function for performance logging
export function logPerformance(
  operation: string,
  duration: number,
  metadata?: Record<string, unknown>
): void {
  logger.info('Performance metric', {
    operation,
    duration,
    ...metadata,
  });
}

// Helper function for workflow logging
export function logWorkflow(
  workflowId: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  logger.info(message, {
    workflowId,
    ...metadata,
  });
}

// Helper function for activity logging
export function logActivity(
  activityId: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  logger.info(message, {
    activityId,
    ...metadata,
  });
}
