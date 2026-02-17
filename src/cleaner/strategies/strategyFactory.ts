import { inject } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { StrategyNotFoundError } from '../errors';
import type { ITaskStrategy } from './taskStrategy';

export interface TaskContext {
  jobId: string;
  taskId: string;
  jobType: string;
  taskType: string;
}

export interface ITaskStrategyHandle extends AsyncDisposable {
  strategy: ITaskStrategy;
}

/**
 * Strategies are registered in the DI container with their task type as the token.
 */
export class StrategyFactory {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    private readonly container: DependencyContainer
  ) {}

  /**
   * Resolves a strategy with enriched logger context for a specific task.
   * @param taskContext - Task context (jobId, taskId, jobType, taskType)
   * @returns Strategy instance with enriched logger
   * @throws StrategyNotFoundError if no strategy is registered for the task type
   */
  public resolveWithContext(taskContext: TaskContext): ITaskStrategyHandle {
    this.logger.debug({ msg: 'Resolving strategy with task context', ...taskContext });

    if (!this.container.isRegistered(taskContext.taskType)) {
      throw new StrategyNotFoundError(taskContext.taskType);
    }

    const taskContainer = this.container.createChildContainer();

    const taskLogger = this.logger.child({
      ...taskContext,
    });

    taskContainer.register(SERVICES.LOGGER, { useValue: taskLogger });

    const strategy = taskContainer.resolve<ITaskStrategy>(taskContext.taskType);

    taskLogger.debug({ msg: 'Strategy resolved successfully with task context' });

    return {
      strategy,
      [Symbol.asyncDispose]: async (): Promise<void> => {
        taskLogger.debug({ msg: 'Disposing task container' });
        await taskContainer.dispose();
      },
    };
  }
}
