import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { container, DependencyContainer } from 'tsyringe';
import { faker } from '@faker-js/faker';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '../src/common/constants';
import { StrategyFactory, TilesDeletionStrategy, type ITaskStrategy, type TaskContext } from '../src/cleaner/strategies';
import { StrategyNotFoundError } from '../src/cleaner/errors';
import { createMockLogger } from './helpers/mocks';

// Mock strategy for testing
class MockStrategy implements ITaskStrategy {
  public validate(params: unknown): Record<string, unknown> {
    return params as Record<string, unknown>;
  }

  public async execute(): Promise<void> {
    // Mock implementation
  }
}

describe('StrategyFactory', () => {
  let strategyFactory: StrategyFactory;
  let mockLogger: Logger;
  let childContainer: DependencyContainer;

  beforeEach(() => {
    mockLogger = createMockLogger();
    childContainer = container.createChildContainer();
    childContainer.register(SERVICES.LOGGER, { useValue: mockLogger });

    // Create factory with child container
    strategyFactory = new StrategyFactory(mockLogger, childContainer);
  });

  afterEach(() => {
    childContainer.clearInstances();
  });

  describe('resolveWithContext', () => {
    it('should resolve registered strategy with enriched logger context', () => {
      const taskType = 'tiles-deletion';
      childContainer.register(taskType, { useClass: TilesDeletionStrategy });

      const taskContext: TaskContext = {
        jobId: faker.string.uuid(),
        taskId: faker.string.uuid(),
        jobType: 'Ingestion_Update',
        taskType,
      };

      const handle = strategyFactory.resolveWithContext(taskContext);

      expect(handle.strategy).toBeInstanceOf(TilesDeletionStrategy);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Resolving strategy with task context',
          jobId: taskContext.jobId,
          taskId: taskContext.taskId,
          jobType: taskContext.jobType,
          taskType: taskContext.taskType,
        })
      );
    });

    it('should create child logger with task context', () => {
      const taskType = 'tiles-deletion';
      childContainer.register(taskType, { useClass: TilesDeletionStrategy });

      const taskContext: TaskContext = {
        jobId: faker.string.uuid(),
        taskId: faker.string.uuid(),
        jobType: 'Ingestion_Swap_Update',
        taskType,
      };

      strategyFactory.resolveWithContext(taskContext);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.child).toHaveBeenCalledWith({
        jobId: taskContext.jobId,
        taskId: taskContext.taskId,
        jobType: taskContext.jobType,
        taskType: taskContext.taskType,
      });
    });

    it('should throw StrategyNotFoundError for unregistered task type', () => {
      const taskContext: TaskContext = {
        jobId: faker.string.uuid(),
        taskId: faker.string.uuid(),
        jobType: 'Export',
        taskType: 'non-existent-task',
      };

      expect(() => strategyFactory.resolveWithContext(taskContext)).toThrow(StrategyNotFoundError);
    });

    it('should create separate instances for different tasks (child container isolation)', () => {
      const taskType = 'tiles-deletion';
      childContainer.register(taskType, { useClass: TilesDeletionStrategy });

      const context1: TaskContext = { jobId: faker.string.uuid(), taskId: faker.string.uuid(), jobType: 'Ingestion_Update', taskType };
      const context2: TaskContext = { jobId: faker.string.uuid(), taskId: faker.string.uuid(), jobType: 'Ingestion_Update', taskType };

      const handle1 = strategyFactory.resolveWithContext(context1);
      const handle2 = strategyFactory.resolveWithContext(context2);

      // Different instances because of child containers
      expect(handle1.strategy).not.toBe(handle2.strategy);
    });

    it('should resolve different strategies for different task types', () => {
      const taskType1 = 'tiles-deletion';
      const taskType2 = 'files-deletion';

      childContainer.register(taskType1, { useClass: TilesDeletionStrategy });
      childContainer.register(taskType2, { useClass: MockStrategy });

      const context1: TaskContext = { jobId: faker.string.uuid(), taskId: faker.string.uuid(), jobType: 'Ingestion_Update', taskType: taskType1 };
      const context2: TaskContext = { jobId: faker.string.uuid(), taskId: faker.string.uuid(), jobType: 'Ingestion_Update', taskType: taskType2 };

      const handle1 = strategyFactory.resolveWithContext(context1);
      const handle2 = strategyFactory.resolveWithContext(context2);

      expect(handle1.strategy).toBeInstanceOf(TilesDeletionStrategy);
      expect(handle2.strategy).toBeInstanceOf(MockStrategy);
      expect(handle1.strategy).not.toBe(handle2.strategy);
    });

    it('should handle special characters in task type', () => {
      const taskType = 'task-with-special_chars.v2';
      childContainer.register(taskType, { useClass: MockStrategy });

      const taskContext: TaskContext = {
        jobId: faker.string.uuid(),
        taskId: faker.string.uuid(),
        jobType: 'CustomJob',
        taskType,
      };

      const handle = strategyFactory.resolveWithContext(taskContext);

      expect(handle.strategy).toBeInstanceOf(MockStrategy);
    });

    it('should have asyncDispose method for cleanup', async () => {
      const taskType = 'tiles-deletion';
      childContainer.register(taskType, { useClass: TilesDeletionStrategy });

      const taskContext: TaskContext = {
        jobId: faker.string.uuid(),
        taskId: faker.string.uuid(),
        jobType: 'Ingestion_Update',
        taskType,
      };

      const handle = strategyFactory.resolveWithContext(taskContext);

      expect(handle[Symbol.asyncDispose]).toBeDefined();
      expect(typeof handle[Symbol.asyncDispose]).toBe('function');

      // Cleanup should not throw
      await expect(handle[Symbol.asyncDispose]()).resolves.not.toThrow();
    });
  });
});
