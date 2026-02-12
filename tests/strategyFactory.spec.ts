import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { container, DependencyContainer } from 'tsyringe';
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
        jobId: 'job-abc123',
        taskId: 'task-123',
        jobType: 'Ingestion_Update',
        taskType,
      };

      const strategy = strategyFactory.resolveWithContext(taskContext);

      expect(strategy).toBeInstanceOf(TilesDeletionStrategy);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Resolving strategy with task context',
          jobId: 'job-abc123',
          taskId: 'task-123',
          jobType: 'Ingestion_Update',
          taskType: 'tiles-deletion',
        })
      );
    });

    it('should create child logger with task context', () => {
      const taskType = 'tiles-deletion';
      childContainer.register(taskType, { useClass: TilesDeletionStrategy });

      const taskContext: TaskContext = {
        jobId: 'job-def456',
        taskId: 'task-456',
        jobType: 'Ingestion_Swap_Update',
        taskType,
      };

      strategyFactory.resolveWithContext(taskContext);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.child).toHaveBeenCalledWith({
        jobId: 'job-def456',
        taskId: 'task-456',
        jobType: 'Ingestion_Swap_Update',
        taskType: 'tiles-deletion',
      });
    });

    it('should throw StrategyNotFoundError for unregistered task type', () => {
      const taskContext: TaskContext = {
        jobId: 'job-xyz789',
        taskId: 'task-789',
        jobType: 'Export',
        taskType: 'non-existent-task',
      };

      expect(() => strategyFactory.resolveWithContext(taskContext)).toThrow(StrategyNotFoundError);
    });

    it('should create separate instances for different tasks (child container isolation)', () => {
      const taskType = 'tiles-deletion';
      childContainer.register(taskType, { useClass: TilesDeletionStrategy });

      const context1: TaskContext = { jobId: 'job-1', taskId: 'task-1', jobType: 'Ingestion_Update', taskType };
      const context2: TaskContext = { jobId: 'job-1', taskId: 'task-2', jobType: 'Ingestion_Update', taskType };

      const strategy1 = strategyFactory.resolveWithContext(context1);
      const strategy2 = strategyFactory.resolveWithContext(context2);

      // Different instances because of child containers
      expect(strategy1).not.toBe(strategy2);
    });

    it('should resolve different strategies for different task types', () => {
      const taskType1 = 'tiles-deletion';
      const taskType2 = 'files-deletion';

      childContainer.register(taskType1, { useClass: TilesDeletionStrategy });
      childContainer.register(taskType2, { useClass: MockStrategy });

      const context1: TaskContext = { jobId: 'job-multi', taskId: 'task-1', jobType: 'Ingestion_Update', taskType: taskType1 };
      const context2: TaskContext = { jobId: 'job-multi', taskId: 'task-2', jobType: 'Ingestion_Update', taskType: taskType2 };

      const strategy1 = strategyFactory.resolveWithContext(context1);
      const strategy2 = strategyFactory.resolveWithContext(context2);

      expect(strategy1).toBeInstanceOf(TilesDeletionStrategy);
      expect(strategy2).toBeInstanceOf(MockStrategy);
      expect(strategy1).not.toBe(strategy2);
    });

    it('should handle special characters in task type', () => {
      const taskType = 'task-with-special_chars.v2';
      childContainer.register(taskType, { useClass: MockStrategy });

      const taskContext: TaskContext = {
        jobId: 'job-special',
        taskId: 'task-special',
        jobType: 'CustomJob',
        taskType,
      };

      const strategy = strategyFactory.resolveWithContext(taskContext);

      expect(strategy).toBeInstanceOf(MockStrategy);
    });
  });
});
