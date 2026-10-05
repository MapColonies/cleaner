/* eslint-disable @typescript-eslint/unbound-method */
import { expect, vi } from 'vitest';
import { container } from 'tsyringe';
import type { ITaskResponse, TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { StorageProvider } from '@map-colonies/raster-shared';
import type { constructor } from 'tsyringe/dist/typings/types';
import { SERVICES } from '@src/common/constants';
import { getJobAndTaskToken } from '@src/common/dependencyRegistration';
import { TaskPoller } from '@src/worker/taskPoller';
import { ErrorHandler } from '@src/cleaner/errors';
import { DeleteStoredResourcesStrategy, StrategyFactory, TilesDeletionStrategy } from '@src/cleaner/strategies';
import type { ITaskStrategy } from '@src/cleaner/strategies/taskStrategy';
import type { StorageProviders } from '@src/cleaner/storageProviders';
import type { JobTrackerClient } from '@src/cleaner/httpClients';
import type { PollingPairConfig } from '@src/cleaner/types';
import { buildTask } from '../../helpers/fakes/taskFakes';
import { createMockLogger, createMockQueueClient, createMockStrategyConfig, createMockJobTrackerClient } from '../../helpers/mocks';

const POLLER_WATCHDOG_MS = 30_000;

/** A strategy together with the job+task pair it is registered under in `containerConfig`. */
interface StrategyUnderTest {
  pollingPair: PollingPairConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any params shape; ITaskStrategy is generic over it
  strategy: constructor<ITaskStrategy<any>>;
}

const MAX_ATTEMPTS = 3;
const TILES_DELETION_TASK = 'tiles-deletion';

/**
 * The job each strategy is registered under in `containerConfig`, per storage kind: path stores
 * are cleaned on ingestion and layer deletion, the Redis cache on the overseer's cache-deletion jobs.
 */
function tilesDeletionUnderTest(storageProvider: StorageProvider): StrategyUnderTest {
  const jobType = storageProvider === StorageProvider.REDIS ? 'Update_Delete_Cache' : 'Ingestion_Update';
  return { pollingPair: { jobType, taskType: TILES_DELETION_TASK, maxAttempts: MAX_ATTEMPTS }, strategy: TilesDeletionStrategy };
}

function storedResourcesDeletionUnderTest(storageProvider: StorageProvider): StrategyUnderTest {
  const jobType = storageProvider === StorageProvider.REDIS ? 'Swap_Delete_Cache' : 'Delete_Layer';
  return { pollingPair: { jobType, taskType: TILES_DELETION_TASK, maxAttempts: MAX_ATTEMPTS }, strategy: DeleteStoredResourcesStrategy };
}

/**
 * Returns a queue client whose `dequeue` hands out `task` exactly once for the
 * matching pair, then null forever. `ack` / `reject` invoke `onTerminal()` so
 * the caller can stop the poller and assert.
 */
function buildSingleShotQueue(task: ITaskResponse<unknown>, onTerminal: () => void, pair: PollingPairConfig): QueueClient {
  const queue = createMockQueueClient();
  let handedOut = false;

  vi.mocked(queue.dequeue).mockImplementation(((jobType: string, taskType: string) => {
    if (handedOut || jobType !== pair.jobType || taskType !== pair.taskType) {
      return null;
    }
    handedOut = true;
    return task;
  }) as unknown as QueueClient['dequeue']);

  vi.mocked(queue.ack).mockImplementation((() => {
    onTerminal();
  }) as unknown as QueueClient['ack']);

  vi.mocked(queue.reject).mockImplementation((() => {
    onTerminal();
  }) as unknown as QueueClient['reject']);

  return queue;
}

interface TestPollerParams {
  providers: StorageProviders;
  task: ITaskResponse<unknown>;
  /** Config keys merged over the strategy defaults, e.g. the batching knobs. */
  configOverrides?: Record<string, unknown>;
  strategyUnderTest?: StrategyUnderTest;
}

interface TestPoller {
  queueClient: QueueClient;
  jobTrackerClient: JobTrackerClient;
  runSingleTask: () => Promise<void>;
}

/**
 * Wires the real TaskPoller → StrategyFactory → strategy pipeline, with real
 * providers (supplied by the caller) and a single-shot fake QueueClient.
 * The poller terminates as soon as ack/reject fires.
 *
 * The strategies read nothing but batching knobs from config — every storage locator
 * travels in the task params — so the mock config carries no bucket or base path.
 */
function buildPoller({
  providers,
  task,
  configOverrides = {},
  strategyUnderTest = tilesDeletionUnderTest(StorageProvider.S3),
}: TestPollerParams): TestPoller {
  const { pollingPair, strategy } = strategyUnderTest;
  const config = createMockStrategyConfig({ 'queue.dequeueIntervalMs': 0, ...configOverrides });

  container.register(SERVICES.LOGGER, { useValue: createMockLogger() });
  container.register(SERVICES.CONFIG, { useValue: config });
  container.register(SERVICES.STORAGE_PROVIDERS, { useValue: providers });

  const queueClient = buildSingleShotQueue(
    task,
    () => {
      void poller.stop();
    },
    pollingPair
  );
  container.register(SERVICES.QUEUE_CLIENT, { useValue: queueClient });
  // StrategyFactory resolves strategies by the combined job+task token, not the task type alone.
  container.register(getJobAndTaskToken(pollingPair), { useClass: strategy });

  const jobTrackerClient = createMockJobTrackerClient();
  container.register(SERVICES.JOB_TRACKER_CLIENT, { useValue: jobTrackerClient });

  const strategyFactory = container.resolve(StrategyFactory);
  const errorHandler = container.resolve(ErrorHandler);
  const poller = new TaskPoller(createMockLogger(), config, queueClient, strategyFactory, errorHandler, [pollingPair], jobTrackerClient);

  const runSingleTask = async (): Promise<void> => {
    const startPromise = poller.start();
    // Watchdog so a regression doesn't hang the whole suite.
    const watchdog = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Poller did not terminate after task lifecycle')), POLLER_WATCHDOG_MS).unref()
    );
    await Promise.race([startPromise, watchdog]);
  };

  return { queueClient, jobTrackerClient, runSingleTask };
}

interface RunTaskParams extends Omit<TestPollerParams, 'task' | 'strategyUnderTest'> {
  strategyUnderTest: StrategyUnderTest;
  params: unknown;
}

interface TaskRun {
  task: ITaskResponse<unknown>;
  queueClient: QueueClient;
  jobTrackerClient: JobTrackerClient;
}

/** Builds a task carrying `params`, drives it once through the poller and hands back what to assert on. */
async function runTask({ strategyUnderTest, params, ...pollerParams }: RunTaskParams): Promise<TaskRun> {
  const task = buildTask({ type: strategyUnderTest.pollingPair.taskType, parameters: params });
  const { runSingleTask, ...clients } = buildPoller({ ...pollerParams, task, strategyUnderTest });
  await runSingleTask();
  return { task, ...clients };
}

/** The task reached the queue's happy terminal state and the job tracker heard about it. */
function expectTaskAcked({ task, queueClient, jobTrackerClient }: TaskRun): void {
  expect(queueClient.ack).toHaveBeenCalledWith(task.jobId, task.id);
  expect(queueClient.reject).not.toHaveBeenCalled();
  expect(jobTrackerClient.notify).toHaveBeenCalledWith(task.id);
}

/** The task was rejected with `shouldRetry=false` and a reason containing `reason`. */
function expectTaskRejectedUnrecoverable({ task, queueClient, jobTrackerClient }: TaskRun, reason: string): void {
  expect(queueClient.reject).toHaveBeenCalledWith(task.jobId, task.id, false, expect.stringContaining(reason));
  expect(queueClient.ack).not.toHaveBeenCalled();
  expect(jobTrackerClient.notify).toHaveBeenCalledWith(task.id);
}

export {
  tilesDeletionUnderTest,
  storedResourcesDeletionUnderTest,
  buildSingleShotQueue,
  buildPoller,
  runTask,
  expectTaskAcked,
  expectTaskRejectedUnrecoverable,
};
export type { StrategyUnderTest, TestPoller, TestPollerParams, RunTaskParams, TaskRun };
