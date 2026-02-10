import { ConfigurationError } from '../errors';
import type { JobDefinitions, PollingPairConfig, WorkerCapabilities } from '../types';

/**
 * Default max attempts if not specified in task definition.
 */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Builds polling pairs from worker capabilities validated against job definitions.
 *
 * This function validates that all declared job/task pairs exist in the global
 * job definitions and enriches them with maxAttempts from the task definition.
 *
 * @param jobDefinitions - The job definitions from global configuration
 * @param capabilities - The worker's declared capability pairs
 * @returns Array of polling pairs for task polling with maxAttempts included
 *
 * @throws {ConfigurationError} If a declared job or task type is not found in job definitions
 */
export function buildPollingPairs(jobDefinitions: JobDefinitions, capabilities: WorkerCapabilities): PollingPairConfig[] {
  const pollingPairs: PollingPairConfig[] = [];

  for (const capabilityPair of capabilities.pairs) {
    // Validate job type exists
    const jobEntry = Object.entries(jobDefinitions.jobs).find(([, job]) => job.type === capabilityPair.job);
    if (!jobEntry) {
      throw new ConfigurationError(`Worker declares capability for job type "${capabilityPair.job}" but it's not defined in job definitions`);
    }

    // Validate task type exists
    const taskEntry = Object.entries(jobDefinitions.tasks).find(([, task]) => task.type === capabilityPair.task);
    if (!taskEntry) {
      throw new ConfigurationError(`Worker declares capability for task type "${capabilityPair.task}" but it's not defined in job definitions`);
    }

    const [, taskDef] = taskEntry;
    const maxAttempts = taskDef.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    pollingPairs.push({
      jobType: capabilityPair.job,
      taskType: capabilityPair.task,
      maxAttempts,
    });
  }

  return pollingPairs;
}
