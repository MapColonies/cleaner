import type { DeleteFailure, DeleteResourcesResult } from './iStorageProvider';

/**
 * Aggregated view of a batch of delete failures — designed to be embedded in a
 * task rejection reason or log line without further post-processing.
 */
export interface DeleteFailureSummary {
  /** Count of all failures */
  failuresCount: number;
  /** Reasons formatted ordered by descending by count, e.g. `'ENOENT=150, EACCES=3'`. */
  summary: string;
  /** Samples of failing resources ordered by descending by count. */
  samples: string[];
}

export const mergeFailures = ({ source, target }: { source: DeleteFailure; target: DeleteFailure }): DeleteFailure => {
  const failures: DeleteFailure = structuredClone(target);

  source.forEach((failed, reason) => {
    const failure = failures.get(reason);
    failures.set(reason, { count: (failure?.count ?? 0) + failed.count, sample: failure?.sample ?? failed.sample });
  });

  return failures;
};

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

  const sortedFailures = Array.from(failures.entries()).sort(([, { count: a }], [, { count: b }]) => b - a);
  const summary = sortedFailures.map(([reason, { count }]) => `${reason}=${count}`).join(', ');
  const samples = sortedFailures.map(([reason, { sample }]) => `${sample} (${reason})`);
  return { failuresCount, summary, samples };
}
