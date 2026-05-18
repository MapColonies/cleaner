/* eslint-disable @typescript-eslint/unbound-method */
import { vi } from 'vitest';
import { container } from 'tsyringe';
import { SourceType } from '@map-colonies/raster-shared';
import type { ITaskResponse, TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { SERVICES } from '@src/common/constants';
import type { ConfigType } from '@src/common/config';
import { TaskPoller } from '@src/worker/taskPoller';
import { ErrorHandler } from '@src/cleaner/errors';
import { StrategyFactory, TilesDeletionStrategy } from '@src/cleaner/strategies';
import type { IStorageProvider } from '@src/cleaner/storageProviders';
import type { JobTrackerClient } from '@src/cleaner/httpClients';
import type { PollingPairConfig } from '@src/cleaner/types';
import { createMockLogger, createMockQueueClient, createMockStrategyConfig, createMockJobTrackerClient } from '../../helpers/mocks';
import type { MinioHandle } from './minioContainer';

const TASK_TYPE = 'tiles-deletion';
const JOB_TYPE = 'Ingestion_Update';
const POLLING_PAIR: PollingPairConfig = { jobType: JOB_TYPE, taskType: TASK_TYPE, maxAttempts: 3 };
const POLLER_WATCHDOG_MS = 30_000;

function buildS3ConfigForMinio(handle: MinioHandle): ConfigType {
  return {
    get: () => ({
      endpoint: handle.endpoint,
      accessKeyId: handle.accessKeyId,
      secretAccessKey: handle.secretAccessKey,
      sslEnabled: false,
      forcePathStyle: true,
      region: 'us-east-1',
    }),
  } as unknown as ConfigType;
}

/**
 * Returns a queue client whose `dequeue` hands out `task` exactly once for the
 * matching pair, then null forever. `ack` / `reject` invoke `onTerminal()` so
 * the caller can stop the poller and assert.
 */
function buildSingleShotQueue(task: ITaskResponse<unknown>, onTerminal: () => void): QueueClient {
  const queue = createMockQueueClient();
  let handedOut = false;

  vi.mocked(queue.dequeue).mockImplementation(((jobType: string, taskType: string) => {
    if (handedOut || jobType !== JOB_TYPE || taskType !== TASK_TYPE) {
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
  providers: Map<SourceType, IStorageProvider>;
  bucket: string;
  fsBase: string;
  task: ITaskResponse<unknown>;
}

interface TestPoller {
  queueClient: QueueClient;
  jobTrackerClient: JobTrackerClient;
  runSingleTask: () => Promise<void>;
}

/**
 * Wires the real TaskPoller → StrategyFactory → TilesDeletionStrategy pipeline,
 * with real S3/FS providers (supplied by the caller) and a single-shot fake
 * QueueClient. The poller terminates as soon as ack/reject fires.
 */
function buildPoller({ providers, bucket, fsBase, task }: TestPollerParams): TestPoller {
  const config = createMockStrategyConfig({
    'strategies.tilesDeletion.s3Bucket': bucket,
    'strategies.tilesDeletion.fsBasePath': fsBase,
    'queue.dequeueIntervalMs': 0,
  });

  container.register(SERVICES.LOGGER, { useValue: createMockLogger() });
  container.register(SERVICES.CONFIG, { useValue: config });
  container.register(SERVICES.STORAGE_PROVIDERS, { useValue: providers });

  const queueClient = buildSingleShotQueue(task, () => {
    void poller.stop();
  });
  container.register(SERVICES.QUEUE_CLIENT, { useValue: queueClient });
  container.register(TASK_TYPE, { useClass: TilesDeletionStrategy });

  const jobTrackerClient = createMockJobTrackerClient();
  container.register(SERVICES.JOB_TRACKER_CLIENT, { useValue: jobTrackerClient });

  const strategyFactory = container.resolve(StrategyFactory);
  const errorHandler = container.resolve(ErrorHandler);
  const poller = new TaskPoller(createMockLogger(), config, queueClient, strategyFactory, errorHandler, [POLLING_PAIR], jobTrackerClient);

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

export { TASK_TYPE, JOB_TYPE, POLLING_PAIR, buildS3ConfigForMinio, buildSingleShotQueue, buildPoller };
export type { TestPoller, TestPollerParams };
