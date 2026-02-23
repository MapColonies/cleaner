import { setTimeout as sleep } from 'timers/promises';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient, ITaskResponse } from '@map-colonies/mc-priority-queue';
import type { IWorker } from '@map-colonies/jobnik-sdk';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import type { PollingPairConfig } from '../cleaner/types';
import type { StrategyFactory } from '../cleaner/strategies';
import { UnrecoverableError, type ErrorHandler } from '../cleaner/errors';

/**
 * TaskPoller - Simple bridge to implement IWorker using the old mc-priority-queue SDK
 */
@injectable()
class TaskPoller implements IWorker {
  private shouldStop = false;
  private readonly dequeueIntervalMs: number;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.QUEUE_CLIENT) private readonly queueClient: QueueClient,
    @inject(SERVICES.STRATEGY_FACTORY) private readonly strategyFactory: StrategyFactory,
    @inject(SERVICES.ERROR_HANDLER) private readonly errorHandler: ErrorHandler,
    @inject(SERVICES.POLLING_PAIRS) private readonly pollingPairs: PollingPairConfig[]
  ) {
    this.dequeueIntervalMs = config.get('queue.dequeueIntervalMs') as unknown as number; //TODO:when we create worker config schema we can remove the cast
  }

  public async start(): Promise<void> {
    this.shouldStop = false;
    await this.poll();
  }

  public async stop(): Promise<void> {
    this.shouldStop = true;
    await Promise.resolve();
  }

  // IWorker event methods - delegated to internal EventEmitter (no-op since nothing listens)
  public on(): this {
    return this;
  }

  public off(): this {
    return this;
  }

  public once(): this {
    return this;
  }

  public removeAllListeners(): this {
    return this;
  }

  private async poll(): Promise<void> {
    while (!this.shouldStop) {
      const result = await this.tryDequeue();

      if (!result) {
        await sleep(this.dequeueIntervalMs);
        continue;
      }

      await this.processTask(result);
    }
  }

  private async tryDequeue(): Promise<
    | {
        task: ITaskResponse<unknown>;
        pair: PollingPairConfig;
      }
    | undefined
  > {
    for (const pair of this.pollingPairs) {
      if (this.shouldStop) {
        return undefined;
      }

      try {
        const task = await this.queueClient.dequeue<unknown>(pair.jobType, pair.taskType);
        if (task) {
          this.logger.info({ msg: 'Task dequeued', taskId: task.id, taskType: task.type, jobId: task.jobId });
          return { task, pair };
        }
      } catch (error) {
        this.logger.error({ msg: 'Dequeue error', error });
      }
    }

    return undefined;
  }

  private async processTask(dequeued: { task: ITaskResponse<unknown>; pair: PollingPairConfig }): Promise<void> {
    const { task, pair } = dequeued;
    const startTime = Date.now();

    this.logger.debug({ msg: 'Task started', taskId: task.id, jobId: task.jobId });

    try {
      if (task.attempts >= pair.maxAttempts) {
        throw new UnrecoverableError(`Task exceeded max attempts: ${task.attempts}/${pair.maxAttempts}`);
      }

      const strategy = this.strategyFactory.resolveWithContext({
        jobId: task.jobId,
        taskId: task.id,
        jobType: pair.jobType,
        taskType: pair.taskType,
      });

      const validated = strategy.validate(task.parameters);
      await strategy.execute(validated);

      await this.queueClient.ack(task.jobId, task.id);

      const duration = Date.now() - startTime;
      this.logger.info({ msg: 'Task completed', taskId: task.id, duration });
    } catch (error) {
      await this.handleTaskFailure(error, task, pair);
    }
  }

  private async handleTaskFailure(error: unknown, task: ITaskResponse<unknown>, pair: PollingPairConfig): Promise<void> {
    const decision = this.errorHandler.handleError({
      jobId: task.jobId,
      taskId: task.id,
      attemptNumber: task.attempts,
      maxAttempts: pair.maxAttempts,
      error: error instanceof Error ? error : new Error(String(error)),
    });

    try {
      await this.queueClient.reject(task.jobId, task.id, decision.shouldRetry, decision.reason);
    } catch (error) {
      this.logger.error({ msg: 'Failed to reject task', taskId: task.id, error });
    }
  }
}

export { TaskPoller };
