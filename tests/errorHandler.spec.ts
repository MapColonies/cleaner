import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import type { Logger } from '@map-colonies/js-logger';
import { ErrorHandler, RecoverableError, UnrecoverableError, ValidationError } from '../src/cleaner/errors';
import type { ErrorContext } from '../src/cleaner/types';
import { createMockLogger } from './helpers/mocks';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    errorHandler = new ErrorHandler(mockLogger);
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
        expect(decision.reason).toContain('Unrecoverable error');
        expect(mockLogger.error).toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalled();
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
        expect(decision.reason).toContain('RecoverableError');
        expect(decision.reason).toContain('Network timeout');
        expect(decision.reason).toContain('1/3');
        expect(mockLogger.info).toHaveBeenCalled();
      });

      it('should not retry when max attempts reached', () => {
        const error = new RecoverableError('Network timeout');
        const context: ErrorContext = { ...baseContext, attemptNumber: 3, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(false);
        expect(decision.reason).toContain('Max attempts');
        expect(decision.reason).toContain('3');
        expect(decision.reason).toContain('Network timeout');
        expect(mockLogger.warn).toHaveBeenCalled();
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
        expect(decision.reason).toContain('Unknown error');
        expect(decision.reason).toContain('Unknown error type');
        expect(decision.reason).toContain('1/3');
        expect(mockLogger.warn).toHaveBeenCalled();
      });

      it('should not retry unknown errors when max attempts reached', () => {
        const error = new Error('Unknown error');
        const context: ErrorContext = { ...baseContext, attemptNumber: 3, error };

        const decision = errorHandler.handleError(context);

        expect(decision.shouldRetry).toBe(false);
        expect(decision.reason).toContain('Max attempts');
        expect(decision.reason).toContain('Unknown error');
        expect(mockLogger.error).toHaveBeenCalled();
      });
    });
  });
});
