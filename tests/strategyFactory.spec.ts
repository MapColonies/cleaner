import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { container, DependencyContainer } from 'tsyringe';
import { faker } from '@faker-js/faker';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '../src/common/constants';
import { StrategyFactory, TilesDeletionStrategy, type ITaskStrategy } from '../src/cleaner/strategies';
import { StrategyNotFoundError } from '../src/cleaner/errors';
import { createMockLogger } from './helpers/mocks';

// Mock strategy for testing
class MockStrategy implements ITaskStrategy {
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

  describe('resolve', () => {
    it('should resolve registered strategy from container', () => {
      const taskType = 'tiles-deletion';
      childContainer.register(taskType, { useClass: TilesDeletionStrategy });

      const strategy = strategyFactory.resolve(taskType);

      expect(strategy).toBeInstanceOf(TilesDeletionStrategy);
    });

    it('should throw StrategyNotFoundError for unregistered task type', () => {
      const taskType = faker.string.alpha(10);

      expect(() => strategyFactory.resolve(taskType)).toThrow(StrategyNotFoundError);
    });

    it('should resolve different strategies for different task types', () => {
      const taskType1 = 'tiles-deletion';
      const taskType2 = 'files-deletion';

      childContainer.register(taskType1, { useClass: TilesDeletionStrategy });
      childContainer.register(taskType2, { useClass: MockStrategy });

      const strategy1 = strategyFactory.resolve(taskType1);
      const strategy2 = strategyFactory.resolve(taskType2);

      expect(strategy1).toBeInstanceOf(TilesDeletionStrategy);
      expect(strategy2).toBeInstanceOf(MockStrategy);
      expect(strategy1).not.toBe(strategy2);
    });

    it('should resolve same strategy instance for multiple calls (singleton behavior)', () => {
      const taskType = 'tiles-deletion';
      childContainer.registerSingleton(taskType, TilesDeletionStrategy);

      const strategy1 = strategyFactory.resolve(taskType);
      const strategy2 = strategyFactory.resolve(taskType);

      expect(strategy1).toBe(strategy2);
    });

    it('should handle special characters in task type', () => {
      const taskType = 'task-with-special_chars.v2';
      childContainer.register(taskType, { useClass: MockStrategy });

      const strategy = strategyFactory.resolve(taskType);

      expect(strategy).toBeInstanceOf(MockStrategy);
    });
  });
});
