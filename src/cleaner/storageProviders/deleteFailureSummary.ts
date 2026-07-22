import type { DeleteResourcesResult } from './iStorageProvider';

/**
 * Aggregated view of a batch of delete failures — designed to be embedded in a
 * task rejection reason or log line without further post-processing.
 */
export interface DeleteFailureSummary {
  /** Count of all failures */
  failuresCount: number;
  /** Reasons formatted descending by count, e.g. `'ENOENT=150, EACCES=3'`. */
  summary: string;
}

/**
 * Reduces a list of provider delete failures into a compact, log-friendly
 * shape. Lives alongside `IStorageProvider` because it operates purely on
 * `DeleteResourcesResult` — any caller of `provider.delete()` can use it, regardless
 * of which storage backend produced the failures.
 */
export function summarizeDeleteFailures({ failures }: DeleteResourcesResult): DeleteFailureSummary {
  let failuresCount = 0;
  for (const { count } of failures.values()) {
    failuresCount += count;
  }

  const summary = Object.entries(failures)
    .sort(([, { count: a }], [, { count: b }]) => b - a)
    .map(([reason, { count }]) => `${reason}=${count}`)
    .join(', ');
  return { failuresCount, summary };
}
