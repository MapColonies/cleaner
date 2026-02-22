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

      const result = strategy.validate(params);

      expect(result).toEqual({});
    });

    it('should throw ValidationError when schema validation fails', () => {
      const invalidParams = null; // null is not a valid object

      expect(() => strategy.validate(invalidParams)).toThrow(ValidationError);
    });

    it('should throw ValidationError with Zod error details', () => {
      const invalidParams = 'not an object';

      try {
        strategy.validate(invalidParams);
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.validationDetails).toBeDefined();
        expect(Array.isArray(validationError.validationDetails)).toBe(true);
      }
    });
  });

  describe('execute', () => {
    it('should execute with valid typed parameters', async () => {
      const validParams = {}; // Matches TilesDeletionParams type

      await expect(strategy.execute(validParams)).resolves.toBeUndefined();
    });
  });
});
