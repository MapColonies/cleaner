/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from 'vitest';
import { summarizeDeleteFailures } from '@src/cleaner/storageProviders';
import type { DeleteFailure } from '@src/cleaner/storageProviders';

describe('summarizeDeleteFailures', () => {
  it('should return zero counts, empty summary and empty sample for an empty input', () => {
    const result = summarizeDeleteFailures([], 5);
    expect(result).toEqual({ counts: {}, summary: '', sample: [] });
  });

  it('should count occurrences per reason', () => {
    const failures: DeleteFailure[] = [
      { path: 'a', reason: 'ENOENT' },
      { path: 'b', reason: 'ENOENT' },
      { path: 'c', reason: 'EACCES' },
    ];

    const { counts } = summarizeDeleteFailures(failures, 3);

    expect(counts).toEqual({ ENOENT: 2, EACCES: 1 });
  });

  it('should format the summary with reasons sorted by descending count', () => {
    const failures: DeleteFailure[] = [
      { path: 'a', reason: 'EACCES' },
      { path: 'b', reason: 'ENOENT' },
      { path: 'c', reason: 'ENOENT' },
      { path: 'd', reason: 'ENOENT' },
    ];

    const { summary } = summarizeDeleteFailures(failures, 3);

    expect(summary).toBe('ENOENT=3, EACCES=1');
  });

  it('should annotate each sampled path with its reason', () => {
    const failures: DeleteFailure[] = [
      { path: 'tile/1.png', reason: 'ENOENT' },
      { path: 'tile/2.png', reason: 'EACCES' },
    ];

    const { sample } = summarizeDeleteFailures(failures, 3);

    expect(sample).toEqual(['tile/1.png (ENOENT)', 'tile/2.png (EACCES)']);
  });

  it('should cap the sample to sampleSize and preserve input order', () => {
    const failures: DeleteFailure[] = [
      { path: 'a', reason: 'ENOENT' },
      { path: 'b', reason: 'ENOENT' },
      { path: 'c', reason: 'ENOENT' },
      { path: 'd', reason: 'ENOENT' },
    ];

    const { sample } = summarizeDeleteFailures(failures, 2);

    expect(sample).length(2);
  });

  it('should return all failures in the sample when sampleSize exceeds input length', () => {
    const failures: DeleteFailure[] = [{ path: 'a', reason: 'ENOENT' }];

    const { sample } = summarizeDeleteFailures(failures, 10);

    expect(sample).toEqual(['a (ENOENT)']);
  });

  it('should return an empty sample when sampleSize is 0', () => {
    const failures: DeleteFailure[] = [{ path: 'a', reason: 'ENOENT' }];

    const { sample } = summarizeDeleteFailures(failures, 0);

    expect(sample).toEqual([]);
  });
});
