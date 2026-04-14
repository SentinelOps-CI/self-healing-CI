import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nock from 'nock';
import { executeTests } from './test-execution.js';

const ENV_KEYS = [
  'SELF_HEALING_TEST_EXECUTION_MODE',
  'FREESTYLE_API_URL',
  'FREESTYLE_API_KEY',
  'SELF_HEALING_TEST_WORKDIR',
] as const;

describe('test-execution', () => {
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

  const baseParams = {
    repository: 'acme/widget',
    headSha: 'deadbeef',
    branch: 'main',
    testCommand: 'node -e "process.exit(0)"',
    timeoutMs: 30_000,
  };

  it('returns a clear error when execution is disabled', async () => {
    process.env['SELF_HEALING_TEST_EXECUTION_MODE'] = 'disabled';
    const r = await executeTests(baseParams);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/disabled/i);
  });

  it('calls Freestyle HTTP when mode is http', async () => {
    process.env['SELF_HEALING_TEST_EXECUTION_MODE'] = 'http';
    process.env['FREESTYLE_API_URL'] = 'https://freestyle.test';
    process.env['FREESTYLE_API_KEY'] = 'k';

    nock('https://freestyle.test').post('/v1/test-runs').reply(200, {
      success: true,
      output: 'all green',
      duration: 42,
    });

    const r = await executeTests(baseParams);
    expect(r.success).toBe(true);
    expect(r.output).toBe('all green');
  });

  it('runs a local shell command when mode is local', async () => {
    process.env['SELF_HEALING_TEST_EXECUTION_MODE'] = 'local';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shci-test-'));
    process.env['SELF_HEALING_TEST_WORKDIR'] = dir;

    const r = await executeTests({
      ...baseParams,
      testCommand: process.platform === 'win32' ? 'cmd /c echo ok' : 'echo ok',
    });
    expect(r.success).toBe(true);
    expect(r.output?.trim()).toMatch(/ok/i);
  });
});
