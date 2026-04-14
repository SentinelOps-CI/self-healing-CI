import { describe, expect, it } from '@jest/globals';
import { mapRootCauseString } from './root-cause.js';
import { RootCause } from '../workflows/self-healing-workflow.js';

describe('mapRootCauseString', () => {
  it('maps known API strings', () => {
    expect(mapRootCauseString('DEP_UPGRADE')).toBe(RootCause.DEP_UPGRADE);
    expect(mapRootCauseString('UNKNOWN')).toBe(RootCause.UNKNOWN);
  });

  it('falls back for unknown labels', () => {
    expect(mapRootCauseString('not-a-real-cause')).toBe(RootCause.UNKNOWN);
  });
});
