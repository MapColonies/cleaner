import { inject, injectable } from 'tsyringe';
import { type Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import type { ErrorContext, ErrorDecision } from '../types';
import { RecoverableError, UnrecoverableError } from './errors';

/**
 * ErrorHandler centralizes error handling logic for task processing.
 * Determines whether errors should trigger retry or rejection.
 */
@injectable()
export class ErrorHandler {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  /**
   * Handles an error that occurred during task processing.
   *
   * @param context - Error context including job, task, attempts, and error
   * @returns Decision object indicating whether to retry and the reason
   */
  public handleError(context: ErrorContext): ErrorDecision {
    const { jobId, taskId, attemptNumber, maxAttempts, error } = context;
    this.logger.error({
      msg: 'Task processing error',
      jobId,
      taskId,
      attemptNumber,
      maxAttempts,
      err: error,
    });

    const decision = this.evaluateError(context);

    this.logDecision(context, decision);

    return decision;
  }

  /**
   * Evaluates the error and determines the retry decision.
   *
   * - UnrecoverableError: never retry
   * - RecoverableError: retry if attempts remain
   * - Unknown errors: treated as recoverable, retry if attempts remain
   */
  private evaluateError(context: ErrorContext): ErrorDecision {
    const { attemptNumber, maxAttempts, error } = context;

    if (error instanceof UnrecoverableError) {
      return { shouldRetry: false, reason: `Unrecoverable error-${error.name}: ${error.message}` };
    }

    const shouldRetry = attemptNumber < maxAttempts;
    const errorLabel = error instanceof RecoverableError ? error.name : 'Unknown';
    const errorMessage = `${errorLabel} error: ${error.message}`;

    const reason = shouldRetry
      ? `${errorMessage}, attempt ${attemptNumber}/${maxAttempts}`
      : `Max attempts (${maxAttempts}) reached for ${errorMessage}`;

    return { shouldRetry, reason };
  }

  private logDecision(context: ErrorContext, decision: ErrorDecision): void {
    const { jobId, taskId, error } = context;
    const isKnownError = error instanceof RecoverableError || error instanceof UnrecoverableError;

    const logData = {
      msg: decision.shouldRetry ? 'Task will be retried' : 'Task will be rejected',
      jobId,
      taskId,
      reason: decision.reason,
    };

    if (decision.shouldRetry && isKnownError) {
      this.logger.info(logData);
    } else {
      this.logger.warn(logData);
    }
  }
}
