import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import nock from 'nock';
import { validateProofs } from './lean-proof-client.js';

const ENV_KEYS = [
  'LEAN_API_URL',
  'LEAN_API_KEY',
  'LEAN_PROOFS_EXECUTION_MODE',
] as const;

describe('lean-proof-client', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    nock.cleanAll();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  it('short-circuits when there are no proof files', async () => {
    const r = await validateProofs({
      repository: 'a/b',
      headSha: 'x',
      branch: 'main',
      proofFiles: [],
    });
    expect(r.success).toBe(true);
    expect(r.totalProofs).toBe(0);
  });

  it('http mode fails fast when API is not configured', async () => {
    process.env['LEAN_PROOFS_EXECUTION_MODE'] = 'http';
    const r = await validateProofs({
      repository: 'a/b',
      headSha: 'x',
      branch: 'main',
      proofFiles: ['Proofs/Foo.lean'],
    });
    expect(r.success).toBe(false);
    expect(r.errors.some(e => /LEAN_API/i.test(e))).toBe(true);
  });

  it('parses a successful Lean HTTP response', async () => {
    process.env['LEAN_PROOFS_EXECUTION_MODE'] = 'http';
    process.env['LEAN_API_URL'] = 'https://lean.test';
    process.env['LEAN_API_KEY'] = 'secret';

    nock('https://lean.test').post('/v1/proofs/validate').reply(200, {
      success: true,
      validatedProofs: 3,
      totalProofs: 3,
      errors: [],
    });

    const r = await validateProofs({
      repository: 'a/b',
      headSha: 'x',
      branch: 'main',
      proofFiles: ['a.lean'],
    });
    expect(r.success).toBe(true);
    expect(r.validatedProofs).toBe(3);
  });
});
