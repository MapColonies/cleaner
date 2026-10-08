import { NoSuchKey } from '@aws-sdk/client-s3';
import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { StorageProvider, TilesDeletionParams, tilesDeletionParamsSchema } from '@map-colonies/raster-shared';
import { inject, injectable } from 'tsyringe';
import type { ConfigType } from '@common/config';
import { PERCENTAGE_COMPLETE, SERVICES } from '@common/constants';
import type { CleanerMetrics } from '@src/cleaner/metrics';
import {
  countFailures,
  mergeFailures,
  summarizeDeleteFailures,
  type DeleteFailure,
  type ResolvedStorageProvider,
  type StorageProviders,
  type StorageTarget,
} from '@src/cleaner/storageProviders';
import { RecoverableError, UnrecoverableError, describeError } from '../errors';
import { resolveTileKeyGenerator, validateSchema } from '../utils';
import type { TaskContext } from './strategyFactory';
import { StrategyName } from './constants';
import type { ITaskStrategy } from './taskStrategy';

const NOT_FOUND_REASONS = new Set<string>([NoSuchKey.name, 'ENOENT']);

interface TileBatch {
  zoom: number;
  keys: string[];
}

@injectable()
export class TilesDeletionStrategy implements ITaskStrategy<TilesDeletionParams> {
  public readonly name = StrategyName.TILES_DELETION;
  private readonly batchSize: number;
  private readonly concurrency: number;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.STORAGE_PROVIDERS) private readonly storageProviders: StorageProviders,
    @inject(SERVICES.QUEUE_CLIENT) private readonly queueClient: QueueClient,
    @inject(SERVICES.TASK_CONTEXT) private readonly taskContext: TaskContext,
    @inject(SERVICES.CLEANER_METRICS) private readonly metrics: CleanerMetrics
  ) {
    this.batchSize = config.get('strategies.tilesDeletion.batchSize') as unknown as number;
    this.concurrency = config.get('strategies.tilesDeletion.concurrency') as unknown as number;
  }

  public validate(params: unknown): TilesDeletionParams {
    this.logger.debug({ msg: `Validating input parameters` });
    return validateSchema(tilesDeletionParamsSchema, params, this.logger);
  }

  public async execute(params: TilesDeletionParams): Promise<void> {
    const { provider, storageTarget, relativePath } = this.resolveStorageProvider(params);
    await this.assertTargetExists(provider, storageTarget, relativePath);

    const totalTiles = this.countTiles(params);

    this.logger.info({
      msg: 'Starting tiles deletion',
      provider: params.storageProvider,
      storageTarget,
      rangeCount: params.ranges.length,
      totalTiles,
    });

    const { failures, deletedCount } = await this.deleteTiles(provider, storageTarget, params, totalTiles);
    this.reportOutcome(failures, totalTiles, deletedCount);
  }

  /**
   * Decides whether the deletion run succeeded, succeeded-with-missing-tiles, or
   * must be retried, and logs at the appropriate level. Not-found failures are
   * treated as success (deletion is idempotent — a tile that's already gone
   * matches the desired end-state) but counted separately for visibility.
   * Terminal progress to 100% is handled by the queue's task-ack — no explicit call needed here.
   */
  private reportOutcome(failures: DeleteFailure, totalTiles: number, deletedCount: number): void {
    const retryable: DeleteFailure = new Map();
    const notFound: DeleteFailure = new Map();
    for (const [reason, failure] of failures) {
      (NOT_FOUND_REASONS.has(reason) ? notFound : retryable).set(reason, failure);
    }
    const notFoundCount = countFailures(notFound);

    if (retryable.size > 0) {
      const { failuresCount, samples, summary } = summarizeDeleteFailures({ failures: retryable });
      this.logger.error({
        msg: 'Tiles deletion partially failed',
        totalTiles,
        uniqueFailureTypesCount: retryable.size,
        notFoundCount,
        deletedCount,
        totalFailuresCount: failuresCount,
        summary,
        samples,
      });
      throw new RecoverableError(`Failed to delete ${failuresCount} tiles. Reasons: ${summary}. Samples: ${samples.join(', ')}`);
    }

    if (notFound.size > 0) {
      this.logger.warn({
        msg: 'Tiles deletion completed with missing tiles',
        totalTiles,
        notFoundCount,
        deletedCount,
        allTilesMissing: notFoundCount === totalTiles,
      });
      return;
    }

    this.logger.info({ msg: 'Tiles deletion completed successfully', totalTiles, deletedCount });
  }

  private resolveStorageProvider(params: TilesDeletionParams): StorageTarget & { provider: ResolvedStorageProvider } {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const storageProvider = this.storageProviders[params.storageProvider];
    if (storageProvider === undefined) throw new UnrecoverableError(`Unsupported storage provider ${params.storageProvider}`);
    const target = this.resolveTarget(params);
    this.logger.debug({ msg: `Using ${params.storageProvider} provider`, ...target });
    return { provider: storageProvider, ...target };
  }

  private resolveTarget(params: TilesDeletionParams): StorageTarget {
    switch (params.storageProvider) {
      case StorageProvider.S3:
        return { storageTarget: params.bucket, relativePath: params.tilesRelativePath };
      case StorageProvider.FS:
        return { storageTarget: params.subPath, relativePath: params.tilesRelativePath };
      case StorageProvider.REDIS:
        return { storageTarget: params.prefix };
    }
  }

  private async assertTargetExists(provider: ResolvedStorageProvider, storageTarget: string, relativePath?: string): Promise<void> {
    if (provider.targetExists === undefined || relativePath === undefined) {
      return;
    }
    if (!(await provider.targetExists(storageTarget, relativePath))) {
      throw new UnrecoverableError(`Tiles storage target does not exist: ${storageTarget}/${relativePath}`);
    }
  }

  private async deleteTiles(
    provider: ResolvedStorageProvider,
    storageTarget: string,
    params: TilesDeletionParams,
    totalTiles: number
  ): Promise<{ failures: DeleteFailure; deletedCount: number }> {
    const { jobId, taskId } = this.taskContext;
    let failures: DeleteFailure = new Map();
    const pendingBatches: TileBatch[] = [];
    let processedTiles = 0;
    let deletedCount = 0;

    for (const batch of this.generateBatches(params)) {
      pendingBatches.push(batch);
      if (pendingBatches.length === this.concurrency) {
        const flushed = await this.flushBatches(provider, storageTarget, params.storageProvider, pendingBatches);
        processedTiles += flushed.processedTilesCount;
        deletedCount += flushed.deletedCount;
        failures = mergeFailures({ source: flushed.batchFailures, target: failures });
        const percentage = Math.round((processedTiles / totalTiles) * PERCENTAGE_COMPLETE);
        await this.queueClient.updateProgress(jobId, taskId, percentage);
        this.logger.info({ msg: 'Tiles deletion progress', deletionProgress: `${processedTiles}/${totalTiles}`, failedTiles: failures.size });
      }
    }

    if (pendingBatches.length > 0) {
      const flushed = await this.flushBatches(provider, storageTarget, params.storageProvider, pendingBatches);
      processedTiles += flushed.processedTilesCount;
      deletedCount += flushed.deletedCount;
      failures = mergeFailures({ source: flushed.batchFailures, target: failures });
      this.logger.info({ msg: 'Tiles deletion progress', deletionProgress: `${processedTiles}/${totalTiles}`, failedTiles: failures.size });
    }

    return { failures, deletedCount };
  }

  /**
   * Deletes all pending batches concurrently via Promise.allSettled.
   * Soft failures (entries returned by provider.delete with reason) and hard failures
   * (rejected promises — expanded into per-path failures with the thrown error as
   * the reason) are both collected so nothing is silently lost and every failed path
   * carries a cause the caller can surface in the task rejection reason.
   * pendingBatches is cleared in-place for reuse.
   */
  private async flushBatches(
    provider: ResolvedStorageProvider,
    storageTarget: string,
    storageProvider: string,
    pendingBatches: TileBatch[]
  ): Promise<{ batchFailures: DeleteFailure; processedTilesCount: number; deletedCount: number }> {
    let failures: DeleteFailure = new Map();
    let deletedCount = 0;

    const processedTilesCount = pendingBatches.reduce((sum, b) => sum + b.keys.length, 0);
    const results = await Promise.allSettled(
      pendingBatches.map(async (batch) => {
        const endTimer = this.metrics.startBatchTimer(storageProvider);
        try {
          return await provider.delete(storageTarget, batch.keys);
        } finally {
          endTimer();
        }
      })
    );
    for (const [index, result] of results.entries()) {
      const batch = pendingBatches[index]!;
      if (result.status === 'fulfilled') {
        failures = mergeFailures({ source: result.value.failures, target: failures });
        deletedCount += result.value.deletedCount;
        this.metrics.recordTilesDeletedByZoom(storageProvider, batch.zoom, result.value.deletedCount);
      } else {
        const error: unknown = result.reason;
        const reason = describeError(error);
        this.logger.error({ msg: 'Batch delete threw unexpectedly', reason, error });
        const failure = failures.get(reason);
        failures.set(reason, { count: (failure?.count ?? 0) + batch.keys.length, sample: failure?.sample ?? batch.keys[0]! });
      }
    }
    pendingBatches.length = 0;

    const labels = { strategy: this.name, storageProvider };
    this.metrics.recordDeleted(labels, deletedCount);
    this.metrics.recordFailures(labels, failures);
    return { batchFailures: failures, processedTilesCount, deletedCount };
  }

  /**
   * Calculates the total number of tiles across all ranges in the deletion params.
   * For each range, the tile count is the product of the width (maxX - minX + 1)
   * and height (maxY - minY + 1) of the range grid.
   */
  private countTiles(params: TilesDeletionParams): number {
    return params.ranges.reduce((sum, r) => sum + (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1), 0);
  }

  /** Yields batches of up to batchSize keys, starting a new batch whenever the zoom level changes. */
  private *generateBatches(params: TilesDeletionParams): Generator<TileBatch> {
    const toKeys = resolveTileKeyGenerator(params);
    let batch: TileBatch | undefined;

    for (const range of params.ranges) {
      if (batch !== undefined && batch.zoom !== range.zoom) {
        yield batch;
        batch = undefined;
      }
      for (const key of toKeys(range)) {
        batch ??= { zoom: range.zoom, keys: [] };
        batch.keys.push(key);
        if (batch.keys.length === this.batchSize) {
          yield batch;
          batch = undefined;
        }
      }
    }

    if (batch !== undefined) {
      yield batch;
    }
  }
}
