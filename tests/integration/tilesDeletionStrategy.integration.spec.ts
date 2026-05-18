/* eslint-disable @typescript-eslint/unbound-method */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { faker } from '@faker-js/faker';
import { type TilesDeletionParams } from '@map-colonies/raster-shared';
import { buildTask } from '../helpers/fakes/taskFakes';
import {
  fsBackend,
  s3Backend,
  setupTestStorageContext,
  startBackends,
  stopBackends,
  teardownTestStorageContext,
  type BackendHandles,
  type TestStorageContext,
} from './helpers/backendFixtures';
import { buildPoller, TASK_TYPE } from './helpers/testPoller';
import { extraTilePathsAroundRanges, extraTilePathsAtAdjacentZooms, tilePathsForRanges } from './helpers/tileFixtures';

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
  ])('$sourceProvider provider', (backend) => {
    it('polls the task, runs the strategy against the chosen provider, and acks after deleting only the requested tiles', async () => {
      const tilesPath = `${faker.string.uuid()}/${faker.string.uuid()}`;
      const params: TilesDeletionParams = {
        sourceProvider: backend.sourceProvider,
        tilesPath,
        fileExtension: 'png',
        ranges: [{ zoom: 10, minX: 5, maxX: 7, minY: 5, maxY: 7 }],
      };
      const target = tilePathsForRanges(params);
      const extras = [...extraTilePathsAroundRanges(params, 2), ...extraTilePathsAtAdjacentZooms(params, [-1, 1])];
      await backend.seed([...target, ...extras]);
      const task = buildTask({ type: TASK_TYPE, parameters: params });

      const { runSingleTask, queueClient, jobTrackerClient } = buildPoller({ ...storageContext, task });
      await runSingleTask();

      const remaining = await backend.list(`${tilesPath}/`);
      expect(remaining.sort()).toEqual([...extras].sort());
      expect(queueClient.ack).toHaveBeenCalledWith(task.jobId, task.id);
      expect(queueClient.reject).not.toHaveBeenCalled();
      expect(jobTrackerClient.notify).toHaveBeenCalledWith(task.id);
    });
  });
});
