import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import jsLogger from '@map-colonies/js-logger';
import { toError, ErrorHandler, RecoverableError, UnrecoverableError, ValidationError } from '../src/cleaner/errors';
import type { ErrorContext } from '../src/cleaner/types';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler(jsLogger({ enabled: false }));
  });

  describe('handleError', () => {
    const baseContext: Omit<ErrorContext, 'error'> = {
      jobId: faker.string.uuid(),
      taskId: faker.string.uuid(),
      attemptNumber: 1,
      maxAttempts: 3,
    };

    describe('UnrecoverableError handling', () => {
      it('should not retry for unrecoverable errors regardless of attempts', () => {
        const error = new ValidationError('Invalid schema');
        const context: ErrorContext = { ...baseContext, attemptNumber: 1, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(false);
      });

      it('should not retry even on first attempt', () => {
        const error = new UnrecoverableError('Fatal error');
        const context: ErrorContext = { ...baseContext, attemptNumber: 1, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(false);
      });
    });

    describe('RecoverableError handling', () => {
      it('should retry when attempts remain', () => {
        const error = new RecoverableError('Network timeout');
        const context: ErrorContext = { ...baseContext, attemptNumber: 1, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(true);
      });

      it('should not retry when max attempts reached', () => {
        const error = new RecoverableError('Network timeout');
        const context: ErrorContext = { ...baseContext, attemptNumber: 3, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(false);
      });

      it('should retry on second attempt if max is 3', () => {
        const error = new RecoverableError('Temporary failure');
        const context: ErrorContext = { ...baseContext, attemptNumber: 2, maxAttempts: 3, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(true);
        expect(decision.reason).toContain('2/3');
      });
    });

    describe('Unknown error handling', () => {
      it('should treat unknown errors as recoverable and retry', () => {
        const error = new Error('Unknown error type');
        const context: ErrorContext = { ...baseContext, attemptNumber: 1, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(true);
      });

      it('should not retry unknown errors when max attempts reached', () => {
        const error = new Error('Unknown error');
        const context: ErrorContext = { ...baseContext, attemptNumber: 3, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(false);
      });
    });
  });
});

describe('toError', () => {
  it('passes through an existing Error instance unchanged', () => {
    const original = new UnrecoverableError('original');
    expect(toError(original)).toBe(original);
  });

  it('wraps a string into an Error with that message', () => {
    const result: Error = toError('raw string');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('raw string');
  });

  it('wraps a number into an Error', () => {
    const result: Error = toError(42);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('42');
  });

  it('wraps null into an Error', () => {
    const result: Error = toError(null);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('null');
  });

  it('falls back to a generic message when toString() throws', () => {
    const hostile = {
      toString: () => {
        throw new Error('toString failed');
      },
    };
    const result: Error = toError(hostile);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('non-serializable thrown value');
  });
});
