import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { buildCloudEventEnvelope, sendCloudEvent } from './cloud-events.js';

describe('cloud-events', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env['CLOUDEVENTS_INGEST_URL'];
    delete process.env['CLOUDEVENTS_INGEST_TOKEN'];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('buildCloudEventEnvelope matches CloudEvents 1.0 shape', () => {
    const env = buildCloudEventEnvelope(
      {
        type: 'com.example.test',
        source: '/workflow/run',
        subject: 'repo-1',
        data: { ok: true },
      },
      'fixed-id'
    );
    expect(env['specversion']).toBe('1.0');
    expect(env['id']).toBe('fixed-id');
    expect(env['type']).toBe('com.example.test');
    expect(env['data']).toEqual({ ok: true });
  });

  it('sendCloudEvent succeeds without ingest URL', async () => {
    const r = await sendCloudEvent({
      type: 't',
      source: 's',
      subject: 'sub',
      data: {},
    });
    expect(r.success).toBe(true);
    expect(r.eventId).toMatch(/^evt_/);
  });

  it('sendCloudEvent POSTs when CLOUDEVENTS_INGEST_URL is set', async () => {
    process.env['CLOUDEVENTS_INGEST_URL'] = 'https://example.com/ingest';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await sendCloudEvent({
      type: 't',
      source: 's',
      subject: 'sub',
      data: { x: 1 },
    });

    expect(r.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe('https://example.com/ingest');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.specversion).toBe('1.0');
    expect(body.data).toEqual({ x: 1 });
  });

  it('sendCloudEvent returns failure on non-OK HTTP', async () => {
    process.env['CLOUDEVENTS_INGEST_URL'] = 'https://example.com/ingest';
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    }) as unknown as typeof fetch;

    const r = await sendCloudEvent({
      type: 't',
      source: 's',
      subject: 'sub',
      data: {},
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('HTTP 502');
  });
});
