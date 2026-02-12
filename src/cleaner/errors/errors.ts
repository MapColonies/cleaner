/**
 * Base class for recoverable errors that can be retried.
 * Task will be retried if attempts < maxAttempts.
 */
export class RecoverableError extends Error {
  public constructor(message: string, cause?: Error) {
    super(message);
    this.name = RecoverableError.name;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Base class for unrecoverable errors that should not be retried.
 * Task will be rejected immediately.
 */
export class UnrecoverableError extends Error {
  public constructor(message: string, cause?: Error) {
    super(message);
    this.name = UnrecoverableError.name;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Configuration error - invalid or missing configuration.
 * This is always unrecoverable and indicates a deployment/configuration issue.
 */
export class ConfigurationError extends UnrecoverableError {
  public constructor(message: string) {
    super(message);
    this.name = ConfigurationError.name;
  }
}

/**
 * Validation error - task parameters failed schema validation.
 * This is always unrecoverable since invalid parameters won't become valid on retry.
 */
export class ValidationError extends UnrecoverableError {
  public constructor(
    message: string,
    public readonly validationDetails?: unknown
  ) {
    super(message);
    this.name = ValidationError.name;
  }
}

/**
 * Strategy not found error - no strategy registered for the task type.
 * This is always unrecoverable since the strategy won't appear on retry.
 */
export class StrategyNotFoundError extends UnrecoverableError {
  public constructor(taskType: string) {
    super(`No strategy registered for task type: ${taskType}`);
    this.name = StrategyNotFoundError.name;
  }
}
