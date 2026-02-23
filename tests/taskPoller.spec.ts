/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { StrategyFactory } from '@src/cleaner/strategies';
import { TaskPoller } from '@src/worker/taskPoller';
import type { PollingPairConfig } from '@src/cleaner/types';
import { ErrorHandler, UnrecoverableError } from '@src/cleaner/errors';
import { createMockQueueClient, createMockStrategyFactory, createMockErrorHandler, createTaskPoller, buildMockStrategy } from './helpers/mocks';
import { buildTask, buildPair } from './helpers/fakes';

describe('TaskPoller', () => {
  let queueClient: QueueClient;
  let strategyFactory: StrategyFactory;
  let errorHandler: ErrorHandler;
  let pollingPairs: PollingPairConfig[];
  let poller: TaskPoller;

  const stopOnAck = () =>
    vi.mocked(queueClient.ack).mockImplementation(async () => {
      await poller.stop();
    });
  const stopOnReject = () =>
    vi.mocked(queueClient.reject).mockImplementation(async () => {
      await poller.stop();
    });
  const stopOnDequeue = () =>
    vi.mocked(queueClient.dequeue).mockImplementation(async () => {
      await poller.stop();
      return null;
    });

  beforeEach(() => {
    queueClient = createMockQueueClient();
    strategyFactory = createMockStrategyFactory();
    errorHandler = createMockErrorHandler();
    pollingPairs = [buildPair({ maxAttempts: 5 })];
    poller = createTaskPoller({ queueClient, strategyFactory, errorHandler, pollingPairs });
  });

  describe('stop()', () => {
    it('resolves immediately and is idempotent', async () => {
      await expect(poller.stop()).resolves.toBeUndefined();
      expect(poller['shouldStop']).toBe(true);
    });
  });

  describe('start()', () => {
    it('resets shouldStop so polling resumes after a prior stop()', async () => {
      const task = buildTask({ attempts: 1 });
      vi.mocked(strategyFactory.resolveWithContext).mockReturnValue(buildMockStrategy());
      vi.mocked(queueClient.dequeue).mockResolvedValue(task);
      stopOnAck();

      await poller.start();

      expect(queueClient.ack).toHaveBeenCalledWith(task.jobId, task.id);
    });
  });

  describe('poll loop', () => {
    it('exits cleanly without processing when no task is found', async () => {
      stopOnDequeue();

      await poller.start();

      expect(queueClient.ack).not.toHaveBeenCalled();
      expect(queueClient.reject).not.toHaveBeenCalled();
      expect(strategyFactory.resolveWithContext).not.toHaveBeenCalled();
    });

    it('resolveWithContext → validate → execute → ack on the success path', async () => {
      const [pair] = pollingPairs;
      const params = { key: 'value' };
      const validated = { validated: true };
      const task = buildTask({ type: pair?.taskType, parameters: params, attempts: 1 });
      const strategy = buildMockStrategy();
      vi.mocked(strategy.validate).mockReturnValue(validated);
      vi.mocked(strategyFactory.resolveWithContext).mockReturnValue(strategy);
      vi.mocked(queueClient.dequeue).mockResolvedValue(task);
      stopOnAck();

      await poller.start();

      expect(strategyFactory.resolveWithContext).toHaveBeenCalledWith({
        jobId: task.jobId,
        taskId: task.id,
        jobType: pair?.jobType,
        taskType: pair?.taskType,
      });
      expect(strategy.validate).toHaveBeenCalledWith(params);
      expect(strategy.execute).toHaveBeenCalledWith(validated);
      expect(queueClient.ack).toHaveBeenCalledWith(task.jobId, task.id);
      expect(queueClient.reject).not.toHaveBeenCalled();
    });

    it('skips an erroring pair and continues to the next', async () => {
      pollingPairs = [buildPair({ jobType: 'Job_A', taskType: 'task-a' }), buildPair({ jobType: 'Job_B', taskType: 'task-b' })];
      poller = createTaskPoller({ queueClient, strategyFactory, errorHandler, pollingPairs });

      const task = buildTask({ attempts: 1 });
      vi.mocked(strategyFactory.resolveWithContext).mockReturnValue(buildMockStrategy());
      vi.mocked(queueClient.dequeue).mockRejectedValueOnce(new Error('Network failure')).mockResolvedValueOnce(task);
      stopOnAck();

      await poller.start();

      expect(queueClient.ack).toHaveBeenCalledWith(task.jobId, task.id);
    });

    it('stops iterating pairs mid-loop when shouldStop becomes true', async () => {
      pollingPairs = [buildPair({ jobType: 'Job_A', taskType: 'task-a' }), buildPair({ jobType: 'Job_B', taskType: 'task-b' })];
      poller = createTaskPoller({ queueClient, strategyFactory, errorHandler, pollingPairs });

      stopOnDequeue();

      await poller.start();

      expect(queueClient.dequeue).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleTaskFailure()', () => {
    it('rejects without calling strategy when task.attempts reaches maxAttempts', async () => {
      const pair = pollingPairs[0]!;
      vi.mocked(queueClient.dequeue).mockResolvedValue(buildTask({ attempts: pair.maxAttempts }));
      stopOnReject();

      await poller.start();

      expect(strategyFactory.resolveWithContext).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect(errorHandler.handleError).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(UnrecoverableError) }));
      expect(queueClient.ack).not.toHaveBeenCalled();
      expect(queueClient.reject).toHaveBeenCalled();
    });

    it('calls reject with the decision returned by errorHandler', async () => {
      const task = buildTask({ attempts: 1 });
      const execError = new Error('strategy failed');
      const strategy = buildMockStrategy();
      vi.mocked(strategy.execute).mockRejectedValue(execError);
      vi.mocked(strategyFactory.resolveWithContext).mockReturnValue(strategy);
      vi.mocked(errorHandler.handleError).mockReturnValue({ shouldRetry: true, reason: 'retry it' });
      vi.mocked(queueClient.dequeue).mockResolvedValue(task);
      stopOnReject();

      await poller.start();

      expect(errorHandler.handleError).toHaveBeenCalledWith(expect.objectContaining({ jobId: task.jobId, taskId: task.id, error: execError }));
      expect(queueClient.reject).toHaveBeenCalledWith(task.jobId, task.id, true, 'retry it');
      expect(queueClient.ack).not.toHaveBeenCalled();
    });

    it('wraps a non-Error thrown value into an Error before calling errorHandler', async () => {
      const strategy = buildMockStrategy();
      vi.mocked(strategy.execute).mockRejectedValue('raw string');
      vi.mocked(strategyFactory.resolveWithContext).mockReturnValue(strategy);
      vi.mocked(queueClient.dequeue).mockResolvedValue(buildTask({ attempts: 1 }));
      stopOnReject();

      await poller.start();

      const [{ error }] = vi.mocked(errorHandler.handleError).mock.calls[0] as [{ error: Error }];
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('raw string');
    });

    it('continues polling when queueClient.reject itself throws', async () => {
      const task1 = buildTask({ attempts: 1 });
      const task2 = buildTask({ attempts: 1 });
      const strategy = buildMockStrategy();
      vi.mocked(strategy.execute).mockRejectedValue(new Error('fail'));
      vi.mocked(strategyFactory.resolveWithContext).mockReturnValue(strategy);
      vi.mocked(queueClient.dequeue).mockResolvedValueOnce(task1).mockResolvedValueOnce(task2);

      let rejectCount = 0;
      vi.mocked(queueClient.reject).mockImplementation(async () => {
        if (++rejectCount === 1) throw new Error('reject network error');
        await poller.stop();
      });

      await poller.start();

      expect(queueClient.reject).toHaveBeenCalledTimes(2);
    });
  });

  describe('IWorker event stubs', () => {
    it('on, off, once, and removeAllListeners each return the poller instance', () => {
      expect(poller.on()).toBe(poller);
      expect(poller.off()).toBe(poller);
      expect(poller.once()).toBe(poller);
      expect(poller.removeAllListeners()).toBe(poller);
    });
  });
});
