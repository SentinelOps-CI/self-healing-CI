import { describe, expect, it } from '@jest/globals';
import {
  getWorkflowNameAllowlistTokens,
  workflowNameMatchesAllowlist,
} from './self-healing-policy.js';

describe('self-healing-policy', () => {
  it('matches default tokens', () => {
    expect(workflowNameMatchesAllowlist('CI', ['ci', 'test'])).toBe(true);
    expect(
      workflowNameMatchesAllowlist('My Build', ['ci', 'test', 'build'])
    ).toBe(true);
    expect(workflowNameMatchesAllowlist('Release', ['ci', 'test'])).toBe(false);
  });

  it('respects custom token list parameter', () => {
    expect(workflowNameMatchesAllowlist('Deploy prod', ['deploy'])).toBe(true);
    expect(workflowNameMatchesAllowlist('Deploy prod', ['ci'])).toBe(false);
  });

  it('getWorkflowNameAllowlistTokens returns defaults when env unset', () => {
    const prev = process.env['SELF_HEALING_WORKFLOW_ALLOWLIST'];
    delete process.env['SELF_HEALING_WORKFLOW_ALLOWLIST'];
    try {
      const t = getWorkflowNameAllowlistTokens();
      expect(t).toContain('ci');
      expect(t).toContain('build');
    } finally {
      if (prev !== undefined) {
        process.env['SELF_HEALING_WORKFLOW_ALLOWLIST'] = prev;
      }
    }
  });
});
