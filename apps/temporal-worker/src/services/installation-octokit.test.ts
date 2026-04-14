import { describe, expect, it } from '@jest/globals';
import { parseRepository } from './installation-octokit.js';

describe('parseRepository', () => {
  it('splits owner and repo', () => {
    expect(parseRepository('acme/rocket')).toEqual({
      owner: 'acme',
      repo: 'rocket',
    });
  });

  it('throws on invalid input', () => {
    expect(() => parseRepository('nope')).toThrow();
  });
});
