import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { SERVICES } from '@common/constants';
import { TilesDeletionStrategy } from '@src/cleaner/strategies/tilesDeletionStrategy';
import { ValidationError } from '@src/cleaner/errors';
import { createMockLogger } from './helpers/mocks';

describe('TilesDeletionStrategy', () => {
  let strategy: TilesDeletionStrategy;
  const mockLogger = createMockLogger();

  beforeEach(() => {
    container.clearInstances();
    container.register(SERVICES.LOGGER, { useValue: mockLogger });
    strategy = container.resolve(TilesDeletionStrategy);
  });

  describe('validate', () => {
    it('should validate and return typed parameters when schema passes', () => {
      const params = {}; // Empty object is valid for current TODO schema
      const taskType = 'tiles-deletion';

      const result = strategy.validate(params, taskType);

      expect(result).toEqual({});
      expect(mockLogger.debug).toHaveBeenCalledWith({ taskType }, 'Task parameters validated successfully');
    });

    it('should throw ValidationError when schema validation fails', () => {
      const invalidParams = null; // null is not a valid object
      const taskType = 'tiles-deletion';

      expect(() => strategy.validate(invalidParams, taskType)).toThrow(ValidationError);
      expect(() => strategy.validate(invalidParams, taskType)).toThrow(`Invalid parameters for task type: ${taskType}`);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType,
          errors: expect.any(Array) as unknown[],
        }),
        'Task parameter validation failed'
      );
    });

    it('should throw ValidationError with Zod error details', () => {
      const invalidParams = 'not an object';
      const taskType = 'tiles-deletion';

      try {
        strategy.validate(invalidParams, taskType);
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.validationDetails).toBeDefined();
        expect(Array.isArray(validationError.validationDetails)).toBe(true);
      }
    });

    it('should use task type from polled task for logging', () => {
      const params = {};
      const taskType = 'custom-task-type'; // Different task type

      strategy.validate(params, taskType);

      expect(mockLogger.debug).toHaveBeenCalledWith({ taskType: 'custom-task-type' }, 'Task parameters validated successfully');
    });
  });

  describe('execute', () => {
    it('should execute with valid typed parameters', async () => {
      const validParams = {}; // Matches TilesDeletionParams type

      await expect(strategy.execute(validParams)).resolves.toBeUndefined();

      expect(mockLogger.info).toHaveBeenCalledWith({
        msg: 'Executing tiles deletion task',
        params: validParams,
      });
      expect(mockLogger.info).toHaveBeenCalledWith({
        msg: 'Tiles deletion task completed',
      });
    });
  });

  describe('validate + execute flow', () => {
    it('should validate then execute successfully', async () => {
      const rawParams = {};
      const taskType = 'tiles-deletion';

      const validatedParams = strategy.validate(rawParams, taskType);
      await strategy.execute(validatedParams);

      expect(mockLogger.debug).toHaveBeenCalledWith({ taskType }, 'Task parameters validated successfully');
      expect(mockLogger.info).toHaveBeenCalledWith({
        msg: 'Tiles deletion task completed',
      });
    });
  });
});
