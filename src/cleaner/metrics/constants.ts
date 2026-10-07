/* eslint-disable @typescript-eslint/naming-convention */
/** Outcome of a single task attempt, as seen by this worker — not the job-manager task status. */
export const TaskStatus = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRIED: 'retried',
} as const;

export const FailureReason = {
  NOT_FOUND: 'not_found',
  ACCESS_DENIED: 'access_denied',
  TIMEOUT: 'timeout',
  CONNECTION: 'connection',
  THROTTLED: 'throttled',
  OTHER: 'other',
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

/** Strategy label used when a task fails before its strategy is resolved. */
export const UNKNOWN_STRATEGY = 'unknown';

// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- histogram bucket boundaries
export const TASK_DURATION_BUCKETS_SECONDS = [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200];
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- histogram bucket boundaries
export const BATCH_DURATION_BUCKETS_SECONDS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export type FailureReason = (typeof FailureReason)[keyof typeof FailureReason];

export interface TaskLabels {
  jobType: string;
  taskType: string;
  strategy: string;
}

export interface DeletionLabels {
  strategy: string;
  storageProvider: string;
}
