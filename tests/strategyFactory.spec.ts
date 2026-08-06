import { faker } from '@faker-js/faker';
import type { Logger } from '@map-colonies/js-logger';
import { SourceType } from '@map-colonies/raster-shared';
import { container } from 'tsyringe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IStorageProvider, StorageProviders } from '@src/cleaner/storageProviders';
import { StrategyNotFoundError } from '../src/cleaner/errors';
import { StrategyFactory, TilesDeletionStrategy, type ITaskStrategy, type TaskContext } from '../src/cleaner/strategies';
import { SERVICES } from '../src/common/constants';
import { createMockLogger, createMockQueueClient, createMockStorageProvider, createMockStrategyConfig } from './helpers/mocks';

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
  // eslint-disable-next-line @typescript-eslint/naming-convention
  let mockS3Provider: IStorageProvider<'S3'>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  let mockFsProvider: IStorageProvider<'FS'>;

  beforeEach(() => {
    mockLogger = createMockLogger();

    mockS3Provider = createMockStorageProvider();
    mockFsProvider = createMockStorageProvider();

    const storageProviders: StorageProviders = {
      [SourceType.FS]: mockFsProvider,
      [SourceType.S3]: mockS3Provider,
    };

    container.register(SERVICES.LOGGER, { useValue: mockLogger });
    container.register(SERVICES.CONFIG, { useValue: createMockStrategyConfig() });
    container.register(SERVICES.STORAGE_PROVIDERS, { useValue: storageProviders });
    container.register(SERVICES.QUEUE_CLIENT, { useValue: createMockQueueClient() });

    strategyFactory = new StrategyFactory(mockLogger);
  });

  afterEach(() => {
    // Clear registrations from global container
    container.clearInstances();
  });

  describe('#resolveWithContext', () => {
    it('should resolve registered strategy with enriched logger context', () => {
      const jobType = 'Ingestion_Update';
      const taskType = 'tiles-deletion';
      container.register(`${jobType}-${taskType}`, { useClass: TilesDeletionStrategy });

      const taskContext: TaskContext = {
        jobId: faker.string.uuid(),
        taskId: faker.string.uuid(),
        jobType,
        taskType,
      };

      const strategy = strategyFactory.resolveWithContext(taskContext);

      expect(strategy).toBeInstanceOf(TilesDeletionStrategy);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: taskContext.jobId,
          taskId: taskContext.taskId,
          jobType: taskContext.jobType,
          taskType: taskContext.taskType,
        })
      );
    });

    it('should create child logger with task context', () => {
      const jobType = 'Ingestion_Swap_Update';
      const taskType = 'tiles-deletion';
      container.register(`${jobType}-${taskType}`, { useClass: TilesDeletionStrategy });

      const taskContext: TaskContext = {
        jobId: faker.string.uuid(),
        taskId: faker.string.uuid(),
        jobType,
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
      const jobType = 'Ingestion_Update';
      const taskType = 'tiles-deletion';
      container.register(`${jobType}-${taskType}`, { useClass: TilesDeletionStrategy });

      const context1: TaskContext = { jobId: faker.string.uuid(), taskId: faker.string.uuid(), jobType, taskType };
      const context2: TaskContext = { jobId: faker.string.uuid(), taskId: faker.string.uuid(), jobType, taskType };

      const strategy1 = strategyFactory.resolveWithContext(context1);
      const strategy2 = strategyFactory.resolveWithContext(context2);

      expect(strategy1).not.toBe(strategy2);
    });

    it('should resolve different strategies for different task types', () => {
      const jobType = 'Ingestion_Update';
      const taskType1 = 'tiles-deletion';
      const taskType2 = 'files-deletion';

      container.register(`${jobType}-${taskType1}`, { useClass: TilesDeletionStrategy });
      container.register(`${jobType}-${taskType2}`, { useClass: MockStrategy });

      const context1: TaskContext = { jobId: faker.string.uuid(), taskId: faker.string.uuid(), jobType, taskType: taskType1 };
      const context2: TaskContext = { jobId: faker.string.uuid(), taskId: faker.string.uuid(), jobType, taskType: taskType2 };

      const strategy1 = strategyFactory.resolveWithContext(context1);
      const strategy2 = strategyFactory.resolveWithContext(context2);

      expect(strategy1).toBeInstanceOf(TilesDeletionStrategy);
      expect(strategy2).toBeInstanceOf(MockStrategy);
      expect(strategy1).not.toBe(strategy2);
    });

    it('should handle special characters in task type', () => {
      const jobType = 'CustomJob';
      const taskType = 'task-with-special_chars.v2';
      container.register(`${jobType}-${taskType}`, { useClass: MockStrategy });

      const taskContext: TaskContext = {
        jobId: faker.string.uuid(),
        taskId: faker.string.uuid(),
        jobType,
        taskType,
      };

      const strategy = strategyFactory.resolveWithContext(taskContext);

      expect(strategy).toBeInstanceOf(MockStrategy);
    });
  });
});
