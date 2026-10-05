/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it } from 'vitest';
import { providersWithBatchSizes, useStorageBackends } from './helpers/backendFixtures';
import { sadPathProviders } from './helpers/storageBackends';
import { expectTaskAcked, expectTaskRejectedUnrecoverable, runTask, tilesDeletionUnderTest, type RunTaskParams } from './helpers/testPoller';
import { tilesDeletionBackends } from './helpers/tilesDeletionBackends';
import { bystanderTileKeys, tileKeysForRanges } from './helpers/tileFixtures';
import { BATCHING_SCENARIO, MULTIPLE_RANGES_SCENARIO } from './helpers/tilesDeletionStrategyScenarios';

describe('tiles deletion E2E (polling → strategy → real provider → ack)', () => {
  const harness = useStorageBackends();
  const { handles, storageContext } = harness;

  describe.each(tilesDeletionBackends(harness))('$storageProvider provider', (backend) => {
    const strategyUnderTest = tilesDeletionUnderTest(backend.storageProvider);
    const runTilesDeletion = async (params: unknown, overrides: Partial<RunTaskParams> = {}): ReturnType<typeof runTask> =>
      runTask({ strategyUnderTest, providers: storageContext().providers, params, ...overrides });

    describe('happy path', () => {
      it('polls the task, runs the strategy against the chosen provider, and acks after deleting only the requested tiles', async () => {
        const params = backend.buildParams();
        const format = backend.keyFormat(params);
        const bystanders = bystanderTileKeys(params.ranges, format);
        await backend.seed([...tileKeysForRanges(params.ranges, format), ...bystanders]);

        const run = await runTilesDeletion(params);

        expect(await backend.listTarget(params)).toEqual([...bystanders].sort());
        expectTaskAcked(run);
      });

      it('acks a redelivered task whose tiles are already gone, leaving unrelated tiles intact', async () => {
        const params = backend.buildParams();
        const format = backend.keyFormat(params);
        const bystanders = bystanderTileKeys(params.ranges, format);
        await backend.seed([...tileKeysForRanges(params.ranges, format), ...bystanders]);
        await runTilesDeletion(params);

        // The queue delivers at least once, so the same task can come back after a crash or a
        // visibility timeout. Deleting an already-deleted tile must still be a success.
        const redelivered = await runTilesDeletion(params);

        expect(await backend.listTarget(params)).toEqual([...bystanders].sort());
        expectTaskAcked(redelivered);
      });
    });

    describe('batching', () => {
      it('flushes full batches concurrently, chunks each inside the provider, and reports progress per flush', async () => {
        const params = backend.buildParams({ ranges: [BATCHING_SCENARIO.range] });
        const format = backend.keyFormat(params);
        const target = tileKeysForRanges(params.ranges, format);
        // Guards the arithmetic the progress percentages below are derived from.
        expect(target).toHaveLength(BATCHING_SCENARIO.tileCount);
        const bystanders = bystanderTileKeys(params.ranges, format);
        await backend.seed([...target, ...bystanders]);

        const run = await runTilesDeletion(params, {
          providers: providersWithBatchSizes(handles(), storageContext(), backend.chunkedBatchSizes(BATCHING_SCENARIO.providerChunkSize)),
          configOverrides: {
            'strategies.tilesDeletion.batchSize': BATCHING_SCENARIO.strategyBatchSize,
            'strategies.tilesDeletion.concurrency': BATCHING_SCENARIO.strategyConcurrency,
          },
        });

        expect(await backend.listTarget(params)).toEqual([...bystanders].sort());
        expectTaskAcked(run);
        // One update per flush of `concurrency` full batches. The trailing partial batch reports
        // nothing, and the terminal 100% is the queue's task-ack rather than the strategy's job.
        const { task, queueClient } = run;
        expect(queueClient.updateProgress).toHaveBeenCalledTimes(BATCHING_SCENARIO.expectedFlushCount);
        expect(queueClient.updateProgress).toHaveBeenNthCalledWith(1, task.jobId, task.id, BATCHING_SCENARIO.firstFlushPercentage);
        expect(queueClient.updateProgress).toHaveBeenNthCalledWith(2, task.jobId, task.id, BATCHING_SCENARIO.secondFlushPercentage);
      });
    });

    describe('multiple ranges', () => {
      it('deletes every tile of every range, leaving neighbouring tiles and zooms of each intact', async () => {
        const params = backend.buildParams({ ranges: MULTIPLE_RANGES_SCENARIO.ranges });
        const format = backend.keyFormat(params);
        const target = tileKeysForRanges(params.ranges, format);
        // Guards against a range set that silently collapses to fewer tiles than intended.
        expect(target).toHaveLength(MULTIPLE_RANGES_SCENARIO.tileCount);
        const bystanders = bystanderTileKeys(params.ranges, format);
        await backend.seed([...target, ...bystanders]);

        const run = await runTilesDeletion(params);

        // Every range contributes deletions, and nothing outside them is touched — so a
        // regression that only walked the first range would leave survivors here.
        expect(await backend.listTarget(params)).toEqual([...bystanders].sort());
        expectTaskAcked(run);
      });
    });

    describe('sad path', () => {
      it('rejects the task as unrecoverable without acking', async () => {
        const { params, reason } = backend.sadPath;

        const run = await runTilesDeletion(params(), { providers: sadPathProviders(backend.sadPath, storageContext()) });

        // shouldRetry=false is the whole point: a missing target or an unknown provider is a
        // producer bug, not a blip.
        expectTaskRejectedUnrecoverable(run, reason);
      });
    });
  });
});
