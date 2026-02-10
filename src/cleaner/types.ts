import type { ITaskResponse } from '@map-colonies/mc-priority-queue';

/**
 * Worker capability pair - a single job/task combination this worker handles.
 */
export interface WorkerCapabilityPair {
  job: string;
  task: string;
}

/**
 * Worker capabilities declaration.
 * Defines explicit job/task pairs this worker can handle.
 */
export interface WorkerCapabilities {
  pairs: WorkerCapabilityPair[];
}

/**
 * Job definition from configuration.
 */
export interface JobDefinition {
  type: string;
}

/**
 * Task definition from configuration.
 */
export interface TaskDefinition {
  type: string;
  maxAttempts?: number;
  suspendJobOnFail?: boolean;
}

/**
 * Job definitions structure from configuration.
 * Contains all jobs and tasks defined in the MapColonies ecosystem.
 */
export interface JobDefinitions {
  jobs: Record<string, JobDefinition>;
  tasks: Record<string, TaskDefinition>;
}

/**
 * Job/Task pair configuration for polling.
 * Defines which job types and task types to poll from the queue.
 * Built at runtime from WorkerCapabilities validated against JobDefinitions.
 */
export interface PollingPairConfig {
  jobType: string;
  taskType: string;
  maxAttempts: number;
}

/**
 * Queue configuration.
 */
export interface QueueConfig {
  jobManagerBaseUrl: string;
  heartbeatBaseUrl: string;
  heartbeatIntervalMs: number;
  dequeueIntervalMs: number;
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
