import { setTimeout as sleep } from 'timers/promises';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient, ITaskResponse } from '@map-colonies/mc-priority-queue';
import type { IWorker } from '@map-colonies/jobnik-sdk';
import { MS_PER_SECOND, SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import type { PollingPairConfig } from '../cleaner/types';
import { UNKNOWN_STRATEGY, type StrategyFactory, type StrategyName } from '../cleaner/strategies';
import { UnrecoverableError, type ErrorHandler } from '../cleaner/errors';
import type { JobTrackerClient } from '../cleaner/httpClients';
import { TaskStatus, type CleanerMetrics } from '../cleaner/metrics';

/**
 * TaskPoller - Simple bridge to implement IWorker using the old mc-priority-queue SDK
 */
@injectable()
export class TaskPoller implements IWorker {
  private shouldStop = false;
  private readonly dequeueIntervalMs: number;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.QUEUE_CLIENT) private readonly queueClient: QueueClient,
    @inject(SERVICES.STRATEGY_FACTORY) private readonly strategyFactory: StrategyFactory,
    @inject(SERVICES.ERROR_HANDLER) private readonly errorHandler: ErrorHandler,
    @inject(SERVICES.POLLING_PAIRS) private readonly pollingPairs: PollingPairConfig[],
    @inject(SERVICES.JOB_TRACKER_CLIENT) private readonly jobTrackerClient: JobTrackerClient,
    @inject(SERVICES.CLEANER_METRICS) private readonly metrics: CleanerMetrics
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
    let strategyName: StrategyName | typeof UNKNOWN_STRATEGY = UNKNOWN_STRATEGY;
    let status: TaskStatus;

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
      strategyName = strategy.name;

      await this.metrics.trackInProgress({ taskType: pair.taskType, strategy: strategyName }, async () => {
        const validated = strategy.validate(task.parameters);
        await strategy.execute(validated);
      });

      await this.queueClient.ack(task.jobId, task.id);
      await this.jobTrackerClient.notify(task.id);

      const durationMs = Date.now() - startTime;
      this.logger.info({ msg: 'Task completed', taskId: task.id, durationMs });
      status = TaskStatus.COMPLETED;
    } catch (error) {
      status = await this.handleTaskFailure(error, task, pair);
    }

    const durationSeconds = (Date.now() - startTime) / MS_PER_SECOND;
    this.metrics.recordTaskCompletion({ jobType: pair.jobType, taskType: pair.taskType, strategy: strategyName }, status, durationSeconds);
  }

  private async handleTaskFailure(error: unknown, task: ITaskResponse<unknown>, pair: PollingPairConfig): Promise<TaskStatus> {
    const decision = this.errorHandler.handleError({
      jobId: task.jobId,
      taskId: task.id,
      attemptNumber: task.attempts,
      maxAttempts: pair.maxAttempts,
      error,
    });

    const status = decision.shouldRetry ? TaskStatus.RETRIED : TaskStatus.FAILED;

    try {
      await this.queueClient.reject(task.jobId, task.id, decision.shouldRetry, decision.reason);
    } catch (rejectError) {
      this.logger.error({ msg: 'Failed to reject task', taskId: task.id, error: rejectError });
      return status;
    }

    if (!decision.shouldRetry) {
      await this.jobTrackerClient.notify(task.id);
    }
    return status;
  }
}
