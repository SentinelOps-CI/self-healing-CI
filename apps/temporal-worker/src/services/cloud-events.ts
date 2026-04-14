import { logger } from '../utils/logger.js';

export interface SendCloudEventInput {
  type: string;
  source: string;
  subject: string;
  data: Record<string, unknown>;
}

export interface SendCloudEventResult {
  eventId: string;
  success: boolean;
  error?: string;
}

/**
 * Build a CloudEvents 1.0 JSON object (structured content mode).
 */
export function buildCloudEventEnvelope(
  input: SendCloudEventInput,
  eventId: string
): Record<string, unknown> {
  return {
    specversion: '1.0',
    id: eventId,
    source: input.source,
    type: input.type,
    subject: input.subject,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    data: input.data,
  };
}

/**
 * Emit a CloudEvent: always logs; optionally POSTs to `CLOUDEVENTS_INGEST_URL` when set.
 */
export async function sendCloudEvent(
  input: SendCloudEventInput
): Promise<SendCloudEventResult> {
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const envelope = buildCloudEventEnvelope(input, eventId);
  const startTime = Date.now();

  logger.info('CloudEvent prepared', {
    eventId,
    type: input.type,
    source: input.source,
    subject: input.subject,
  });

  const ingestUrl = process.env['CLOUDEVENTS_INGEST_URL']?.trim();
  if (ingestUrl) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/cloudevents+json; charset=utf-8',
      };
      const token = process.env['CLOUDEVENTS_INGEST_TOKEN']?.trim();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(ingestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.error('CloudEvent ingest HTTP error', {
          eventId,
          status: res.status,
          body: text.slice(0, 500),
          duration: Date.now() - startTime,
        });
        return { eventId, success: false, error: `HTTP ${res.status}` };
      }
      logger.info('CloudEvent delivered', {
        eventId,
        duration: Date.now() - startTime,
      });
      return { eventId, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('CloudEvent ingest failed', {
        eventId,
        error: message,
        duration: Date.now() - startTime,
      });
      return { eventId, success: false, error: message };
    }
  }

  logger.info(
    'CloudEvent (log only; set CLOUDEVENTS_INGEST_URL to POST to an HTTP endpoint)',
    {
      eventId,
      type: input.type,
      subject: input.subject,
      duration: Date.now() - startTime,
    }
  );
  return { eventId, success: true };
}
