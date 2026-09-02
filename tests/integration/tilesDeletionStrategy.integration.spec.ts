/* eslint-disable @typescript-eslint/unbound-method */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { faker } from '@faker-js/faker';
import { buildTask } from '../helpers/fakes/taskFakes';
import {
  fsBackend,
  providersWithBatchSizes,
  s3Backend,
  setupTestStorageContext,
  startBackends,
  stopBackends,
  teardownTestStorageContext,
  type BackendHandles,
  type PathAddressedParams,
  type TestStorageContext,
} from './helpers/backendFixtures';
import { buildPoller, TASK_TYPE } from './helpers/testPoller';
import { extraTilePathsAroundRanges, extraTilePathsAtAdjacentZooms, tilePathsForRanges } from './helpers/tileFixtures';
import { BATCHING_SCENARIO, MULTIPLE_RANGES_SCENARIO } from './helpers/tilesDeletionStrategyScenarios';

describe('tiles deletion E2E (polling → strategy → real provider → ack)', () => {
  let handles: BackendHandles;
  let storageContext: TestStorageContext;

  beforeAll(async () => {
    handles = await startBackends();
  });

  afterAll(async () => {
    await stopBackends(handles);
  });

  beforeEach(async () => {
    storageContext = await setupTestStorageContext(handles);
  });

  afterEach(async () => {
    await teardownTestStorageContext(handles, storageContext);
  });

  describe.each([
    s3Backend(
      () => handles,
      () => storageContext
    ),
    fsBackend(() => storageContext),
  ])('$storageProvider provider', (backend) => {
    describe('happy path', () => {
      it('polls the task, runs the strategy against the chosen provider, and acks after deleting only the requested tiles', async () => {
        const tilesRelativePath = `${faker.string.uuid()}/${faker.string.uuid()}`;
        const params: PathAddressedParams = backend.buildParams(tilesRelativePath);
        const target = tilePathsForRanges(params);
        const extras = [...extraTilePathsAroundRanges(params, 2), ...extraTilePathsAtAdjacentZooms(params, [-1, 1])];
        await backend.seed([...target, ...extras]);
        const task = buildTask({ type: TASK_TYPE, parameters: params });

        const { runSingleTask, queueClient, jobTrackerClient } = buildPoller({ providers: storageContext.providers, task });
        await runSingleTask();
        const remaining = await backend.list(`${tilesRelativePath}/`);

        expect(remaining.sort()).toEqual([...extras].sort());
        expect(queueClient.ack).toHaveBeenCalledWith(task.jobId, task.id);
        expect(queueClient.reject).not.toHaveBeenCalled();
        expect(jobTrackerClient.notify).toHaveBeenCalledWith(task.id);
      });

      it('acks a redelivered task whose tiles are already gone, leaving unrelated tiles intact', async () => {
        const tilesRelativePath = `${faker.string.uuid()}/${faker.string.uuid()}`;
        const params: PathAddressedParams = backend.buildParams(tilesRelativePath);
        const extras = [...extraTilePathsAroundRanges(params, 2), ...extraTilePathsAtAdjacentZooms(params, [-1, 1])];
        await backend.seed([...tilePathsForRanges(params), ...extras]);

        const firstTask = buildTask({ type: TASK_TYPE, parameters: params });
        await buildPoller({ providers: storageContext.providers, task: firstTask }).runSingleTask();

        // The queue delivers at least once, so the same task can come back after a crash or a
        // visibility timeout. Deleting an already-deleted tile must still be a success.
        const redeliveredTask = buildTask({ type: TASK_TYPE, parameters: params });
        const { runSingleTask, queueClient, jobTrackerClient } = buildPoller({ providers: storageContext.providers, task: redeliveredTask });
        await runSingleTask();
        const remaining = await backend.list(`${tilesRelativePath}/`);

        expect(queueClient.ack).toHaveBeenCalledWith(redeliveredTask.jobId, redeliveredTask.id);
        expect(queueClient.reject).not.toHaveBeenCalled();
        expect(jobTrackerClient.notify).toHaveBeenCalledWith(redeliveredTask.id);
        expect(remaining.sort()).toEqual([...extras].sort());
      });
    });

    describe('batching', () => {
      it('flushes full batches concurrently, chunks each inside the provider, and reports progress per flush', async () => {
        const tilesRelativePath = `${faker.string.uuid()}/${faker.string.uuid()}`;
        const params: PathAddressedParams = backend.buildParams(tilesRelativePath, { ranges: [BATCHING_SCENARIO.range] });
        const target = tilePathsForRanges(params);
        // Guards the arithmetic the progress percentages below are derived from.
        expect(target).toHaveLength(BATCHING_SCENARIO.tileCount);

        const extras = extraTilePathsAroundRanges(params, 1);
        await backend.seed([...target, ...extras]);
        const task = buildTask({ type: TASK_TYPE, parameters: params });

        const { runSingleTask, queueClient, jobTrackerClient } = buildPoller({
          providers: providersWithBatchSizes(handles, storageContext, { s3: BATCHING_SCENARIO.s3ChunkSize }),
          task,
          configOverrides: {
            'strategies.tilesDeletion.batchSize': BATCHING_SCENARIO.strategyBatchSize,
            'strategies.tilesDeletion.concurrency': BATCHING_SCENARIO.strategyConcurrency,
          },
        });
        await runSingleTask();
        const remaining = await backend.list(`${tilesRelativePath}/`);

        expect(remaining.sort()).toEqual([...extras].sort());
        expect(queueClient.ack).toHaveBeenCalledWith(task.jobId, task.id);
        expect(queueClient.reject).not.toHaveBeenCalled();
        expect(jobTrackerClient.notify).toHaveBeenCalledWith(task.id);
        // One update per flush of `concurrency` full batches. The trailing partial batch reports
        // nothing, and the terminal 100% is the queue's task-ack rather than the strategy's job.
        expect(queueClient.updateProgress).toHaveBeenCalledTimes(BATCHING_SCENARIO.expectedFlushCount);
        expect(queueClient.updateProgress).toHaveBeenNthCalledWith(1, task.jobId, task.id, BATCHING_SCENARIO.firstFlushPercentage);
        expect(queueClient.updateProgress).toHaveBeenNthCalledWith(2, task.jobId, task.id, BATCHING_SCENARIO.secondFlushPercentage);
      });
    });

    describe('multiple ranges', () => {
      it('deletes every tile of every range, leaving neighbouring tiles and zooms of each intact', async () => {
        const tilesRelativePath = `${faker.string.uuid()}/${faker.string.uuid()}`;
        const params: PathAddressedParams = backend.buildParams(tilesRelativePath, { ranges: MULTIPLE_RANGES_SCENARIO.ranges });
        const target = tilePathsForRanges(params);
        // Guards against a range set that silently collapses to fewer tiles than intended.
        expect(target).toHaveLength(MULTIPLE_RANGES_SCENARIO.tileCount);

        const extras = [...new Set([...extraTilePathsAroundRanges(params, 1), ...extraTilePathsAtAdjacentZooms(params, [-1, 1])])];
        await backend.seed([...target, ...extras]);
        const task = buildTask({ type: TASK_TYPE, parameters: params });

        const { runSingleTask, queueClient, jobTrackerClient } = buildPoller({ providers: storageContext.providers, task });
        await runSingleTask();
        const remaining = await backend.list(`${tilesRelativePath}/`);

        // Every range contributes deletions, and nothing outside them is touched — so a
        // regression that only walked the first range would leave survivors here.
        expect(remaining.sort()).toEqual([...extras].sort());
        expect(queueClient.ack).toHaveBeenCalledWith(task.jobId, task.id);
        expect(queueClient.reject).not.toHaveBeenCalled();
        expect(jobTrackerClient.notify).toHaveBeenCalledWith(task.id);
      });
    });

    describe('sad path', () => {
      it('rejects the task as unrecoverable without acking when the storage target does not exist', async () => {
        // Nothing is seeded, so the path the task points at was never created on the backend.
        const params: PathAddressedParams = backend.buildParams(`${faker.string.uuid()}/${faker.string.uuid()}`);
        const task = buildTask({ type: TASK_TYPE, parameters: params });

        const { runSingleTask, queueClient, jobTrackerClient } = buildPoller({ providers: storageContext.providers, task });
        await runSingleTask();

        // shouldRetry=false is the whole point: a missing target is a producer bug, not a blip.
        expect(queueClient.reject).toHaveBeenCalledWith(task.jobId, task.id, false, expect.stringContaining('storage target does not exist'));
        expect(queueClient.ack).not.toHaveBeenCalled();
        expect(jobTrackerClient.notify).toHaveBeenCalledWith(task.id);
      });
    });
  });
});
