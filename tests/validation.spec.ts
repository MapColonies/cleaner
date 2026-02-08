import { describe, it, expect, beforeEach } from 'vitest';
import type { Logger } from '@map-colonies/js-logger';
import { TaskValidator } from '../src/cleaner/validation';
import { createMockLogger } from './helpers/mocks';

describe('TaskValidator', () => {
  let taskValidator: TaskValidator;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    taskValidator = new TaskValidator(mockLogger);
  });

  describe('validate', () => {
    it('should validate valid tiles-deletion parameters', () => {
      //TODO: implement valid parameters for tiles-deletion task once the schema is defined
      const validParams = {};

      const result = taskValidator.validate('tiles-deletion', validParams);

      expect(result).toEqual(validParams);
      expect(mockLogger.debug).toHaveBeenCalledWith({
        msg: 'Task parameters validated successfully',
        taskType: 'tiles-deletion',
      });
    });

    it('should return validated data on success', () => {
      const params = { someField: 'value' };
      const result = taskValidator.validate('tiles-deletion', params);

      expect(result).toBeDefined();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    //TODO: implement test for invalid parameters once the schema is defined
  });
});
