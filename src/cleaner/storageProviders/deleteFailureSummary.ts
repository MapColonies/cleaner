import type { DeleteFailure } from './iStorageProvider';

/**
 * Aggregated view of a batch of delete failures — designed to be embedded in a
 * task rejection reason or log line without further post-processing.
 */
export interface DeleteFailureSummary {
  /** Raw count per reason string, e.g. `{ ENOENT: 150, EACCES: 3 }`. */
  counts: Record<string, number>;
  /** Reasons formatted descending by count, e.g. `'ENOENT=150, EACCES=3'`. */
  summary: string;
  /** Up to `sampleSize` `path (reason)` strings, preserving input order. */
  sample: string[];
}

/**
 * Reduces a list of provider delete failures into a compact, log-friendly
 * shape. Lives alongside `IStorageProvider` because it operates purely on
 * `DeleteFailure[]` — any caller of `provider.delete()` can use it, regardless
 * of which storage backend produced the failures.
 */
export function summarizeDeleteFailures(failures: DeleteFailure[], sampleSize: number): DeleteFailureSummary {
  const counts: Record<string, number> = {};
  for (const { reason } of failures) {
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  const summary = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ');
  const sample = failures.slice(0, sampleSize).map((f) => `${f.path} (${f.reason})`);
  return { counts, summary, sample };
}
