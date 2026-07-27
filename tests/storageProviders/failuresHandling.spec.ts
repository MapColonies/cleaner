import { describe, it, expect } from 'vitest';
import { summarizeDeleteFailures } from '@src/cleaner/storageProviders';

describe('#summarizeDeleteFailures', () => {
  it('should return zero counts, empty summary for an empty input', () => {
    const failures = { failures: new Map() };

    const result = summarizeDeleteFailures(failures);

    expect(result).toEqual({ failuresCount: 0, summary: '', samples: [] });
  });

  it('should format the summary with reasons and samples sorted by descending count', () => {
    const failures = {
      failures: new Map([
        ['EACCES', { count: 1, sample: 'a' }],
        ['ENOENT', { count: 3, sample: 'b' }],
      ]),
    };

    const result = summarizeDeleteFailures(failures);

    expect(result).toStrictEqual({ failuresCount: 4, summary: 'ENOENT=3, EACCES=1', samples: ['b (ENOENT)', 'a (EACCES)'] });
  });

  it('should annotate each sampled path with its reason', () => {
    const failures = {
      failures: new Map([
        ['ENOENT', { count: 1, sample: 'tile/1.png' }],
        ['EACCES', { count: 1, sample: 'tile/2.png' }],
      ]),
    };

    const { samples } = summarizeDeleteFailures(failures);

    expect(samples).toEqual(['tile/1.png (ENOENT)', 'tile/2.png (EACCES)']);
  });

  it('should order samples by descending count', () => {
    const failures = {
      failures: new Map([
        ['EACCES', { count: 1, sample: 'a' }],
        ['ENOENT', { count: 4, sample: 'b' }],
      ]),
    };

    const { samples } = summarizeDeleteFailures(failures);

    expect(samples).toEqual(['b (ENOENT)', 'a (EACCES)']);
  });
});
