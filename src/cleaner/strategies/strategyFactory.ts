import { inject } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { StrategyNotFoundError } from '../errors';
import type { ITaskStrategy } from './taskStrategy';

/**
 * Factory for resolving task strategies by task type.
 * Strategies are registered in the DI container with their task type as the token.
 */
export class StrategyFactory {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    private readonly container: DependencyContainer
  ) {}

  /**
   * Resolves a strategy for the given task type.
   *
   * @param taskType - The task type to resolve (e.g., 'tiles-deletion')
   * @returns The registered strategy instance
   * @throws StrategyNotFoundError if no strategy is registered for the task type
   */
  public resolve(taskType: string): ITaskStrategy {
    this.logger.debug({ msg: 'Resolving strategy', taskType });

    if (!this.container.isRegistered(taskType)) {
      throw new StrategyNotFoundError(taskType);
    }

    const strategy = this.container.resolve<ITaskStrategy>(taskType);

    this.logger.debug({ msg: 'Strategy resolved successfully', taskType });

    return strategy;
  }
}
