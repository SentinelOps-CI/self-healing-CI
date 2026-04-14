import { log } from '@temporalio/activity';
import { sendCloudEvent } from '../services/cloud-events.js';
import { logger } from '../utils/logger.js';

export interface EmitCloudEventInput {
  eventType: string;
  eventData: Record<string, unknown>;
  source: string;
  subject: string;
}

export interface EmitCloudEventResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

/**
 * Activity to emit CloudEvents (structured log + optional HTTP ingest).
 */
export async function emitCloudEvent(
  input: EmitCloudEventInput
): Promise<EmitCloudEventResult> {
  const startTime = Date.now();
  log.info('Emitting cloud event', {
    eventType: input.eventType,
    source: input.source,
    subject: input.subject,
  });

  try {
    const result = await sendCloudEvent({
      type: input.eventType,
      source: input.source,
      subject: input.subject,
      data: input.eventData,
    });

    logger.info('Cloud event activity completed', {
      eventType: input.eventType,
      eventId: result.eventId,
      success: result.success,
      duration: Date.now() - startTime,
    });

    return {
      success: result.success,
      eventId: result.eventId,
      error: result.error,
    };
  } catch (error) {
    logger.error('Cloud event activity failed', {
      eventType: input.eventType,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
