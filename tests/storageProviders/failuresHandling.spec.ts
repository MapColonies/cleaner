import { describe, it, expect } from 'vitest';
import { mergeFailures, summarizeDeleteFailures, type DeleteFailure } from '@src/cleaner/storageProviders';

describe('failuresHandling', () => {
  describe('#mergeFailures', () => {
    it('should return an empty map when both source and target are empty', () => {
      expect(mergeFailures({ source: new Map(), target: new Map() })).toEqual(new Map());
    });

    it('should return the target entries unchanged for an empty source', () => {
      const target: DeleteFailure = new Map([['ENOENT', { count: 2, sample: 'a' }]]);

      expect(mergeFailures({ source: new Map(), target })).toEqual(target);
    });

    it('should keep entries of both maps when reasons do not overlap', () => {
      const source: DeleteFailure = new Map([['EACCES', { count: 1, sample: 'b' }]]);
      const target: DeleteFailure = new Map([['ENOENT', { count: 2, sample: 'a' }]]);

      expect(mergeFailures({ source, target })).toEqual(
        new Map([
          ['ENOENT', { count: 2, sample: 'a' }],
          ['EACCES', { count: 1, sample: 'b' }],
        ])
      );
    });

    it('should sum counts and keep the target sample when a reason appears in both maps', () => {
      const source: DeleteFailure = new Map([['ENOENT', { count: 3, sample: 'source-sample' }]]);
      const target: DeleteFailure = new Map([['ENOENT', { count: 2, sample: 'target-sample' }]]);

      expect(mergeFailures({ source, target })).toEqual(new Map([['ENOENT', { count: 5, sample: 'target-sample' }]]));
    });

    it('should not mutate the source or the target', () => {
      const source: DeleteFailure = new Map([['ENOENT', { count: 3, sample: 'b' }]]);
      const target: DeleteFailure = new Map([['ENOENT', { count: 2, sample: 'a' }]]);

      mergeFailures({ source, target });

      expect(target).toEqual(new Map([['ENOENT', { count: 2, sample: 'a' }]]));
      expect(source).toEqual(new Map([['ENOENT', { count: 3, sample: 'b' }]]));
    });
  });

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
});
