/**
 * Strategy interface for task execution.
 * Concrete strategies implement task-specific business logic.
 *
 * @template T - The type of validated task parameters (defaults to generic object)
 */
export interface ITaskStrategy<T = Record<string, unknown>> {
  /**
   * Executes the task with validated parameters.
   *
   * @param params - Validated task parameters (validated via Zod schema)
   * @throws RecoverableError for transient failures (will be retried)
   * @throws UnrecoverableError for permanent failures (will be rejected)
   */
  execute: (params: T) => Promise<void>;
}
