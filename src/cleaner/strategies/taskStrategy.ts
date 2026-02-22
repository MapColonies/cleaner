/**
 * Strategy interface for task execution.
 * Concrete strategies implement task-specific business logic and validation.
 *
 * @template T - The type of validated task parameters
 */
export interface ITaskStrategy<T = Record<string, unknown>> {
  /**
   * Validates unknown task parameters against the strategy's schema.
   *
   * @param params - Unknown task parameters to validate
   * @param taskType - Task type from the polled task (for logging/error messages)
   * @returns Typed and validated parameters
   * @throws ValidationError if parameters fail schema validation
   */
  validate: (params: unknown) => T;

  /**
   * Executes the task with validated parameters.
   *
   * @param params - Validated task parameters (output of validate())
   * @throws RecoverableError for transient failures (will be retried)
   * @throws UnrecoverableError for permanent failures (will be rejected)
   */
  execute: (params: T) => Promise<void>;
}
