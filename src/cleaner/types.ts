import type { ITaskResponse } from '@map-colonies/mc-priority-queue';

/**
 * Job/Task pair configuration for polling.
 * Defines which job types and task types to poll from the queue.
 */
export interface PollingPairConfig {
  jobType: string;
  taskType: string;
}

/**
 * Queue configuration including polling pairs.
 */
export interface QueueConfig {
  jobManagerBaseUrl: string;
  heartbeatBaseUrl: string;
  heartbeatIntervalMs: number;
  dequeueIntervalMs: number;
  pairs: PollingPairConfig[];
}

/**
 * Context information for error handling decisions.
 */
export interface ErrorContext {
  jobId: string;
  taskId: string;
  attemptNumber: number;
  maxAttempts: number;
  error: Error;
}

/**
 * Decision made by the error handler.
 */
export interface ErrorDecision {
  shouldRetry: boolean;
  reason: string;
}

/**
 * Task response helper type for strategy implementations.
 */
export type TaskResponse = ITaskResponse<Record<string, unknown>>;
