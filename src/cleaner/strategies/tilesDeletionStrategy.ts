import { NoSuchKey } from '@aws-sdk/client-s3';
import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { SourceType, TileRange, TilesDeletionParams, tilesDeletionParamsSchema } from '@map-colonies/raster-shared';
import { inject, injectable } from 'tsyringe';
import type { ConfigType } from '@common/config';
import { PERCENTAGE_COMPLETE, SERVICES } from '@common/constants';
import {
  mergeFailures,
  summarizeDeleteFailures,
  type DeleteFailure,
  type FsConfig,
  type IStorageProvider,
  type StorageProvider,
  type StorageProviders,
} from '@src/cleaner/storageProviders';
import { RecoverableError, UnrecoverableError, describeError } from '../errors';
import { validateSchema } from '../utils';
import type { TaskContext } from './strategyFactory';
import type { ITaskStrategy } from './taskStrategy';

const NOT_FOUND_REASONS = new Set<string>([NoSuchKey.name, 'ENOENT']);

@injectable()
export class TilesDeletionStrategy implements ITaskStrategy<TilesDeletionParams> {
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly s3Bucket: string;
  private readonly fsBasePath: string;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.STORAGE_PROVIDERS) private readonly storageProviders: StorageProviders,
    @inject(SERVICES.QUEUE_CLIENT) private readonly queueClient: QueueClient,
    @inject(SERVICES.TASK_CONTEXT) private readonly taskContext: TaskContext
  ) {
    this.batchSize = config.get('strategies.tilesDeletion.batchSize') as unknown as number;
    this.concurrency = config.get('strategies.tilesDeletion.concurrency') as unknown as number;
    this.s3Bucket = config.get('strategies.tilesDeletion.s3Bucket') as unknown as string;
    this.fsBasePath = config.get('storage.fs.basePath') as unknown as FsConfig['basePath'];
  }

  public validate(params: unknown): TilesDeletionParams {
    this.logger.debug({ msg: `Validating input parameters` });
    return validateSchema(tilesDeletionParamsSchema, params, this.logger);
  }

  public async execute(params: TilesDeletionParams): Promise<void> {
    const { provider, storageTarget } = this.resolveStorageProvider(params);

    if (!(await provider.targetExists(storageTarget, params.tilesPath))) {
      throw new UnrecoverableError(`${params.sourceProvider} storage target does not exist: ${storageTarget}/${params.tilesPath}`);
    }

    const totalTiles = this.countTiles(params);

    this.logger.info({
      msg: 'Starting tiles deletion',
      provider: params.sourceProvider,
      storageTarget,
      rangeCount: params.ranges.length,
      totalTiles,
    });

    const failures = await this.deleteAllTiles(provider, storageTarget, params, totalTiles);
    this.reportOutcome(failures, totalTiles);
  }

  /**
   * Decides whether the deletion run succeeded, succeeded-with-missing-tiles, or
   * must be retried, and logs at the appropriate level. Not-found failures are
   * treated as success (deletion is idempotent — a tile that's already gone
   * matches the desired end-state) but counted separately for visibility.
   * Terminal progress to 100% is handled by the queue's task-ack — no explicit call needed here.
   */
  private reportOutcome(failures: DeleteFailure, totalTiles: number): void {
    const retryable: DeleteFailure = new Map();
    const notFound: DeleteFailure = new Map();
    for (const failure of failures) {
      (NOT_FOUND_REASONS.has(failure[0]) ? notFound : retryable).set(failure[0], failure[1]);
    }

    const deletedCount = totalTiles - retryable.size - notFound.size;

    if (retryable.size > 0) {
      const { failuresCount, samples, summary } = summarizeDeleteFailures({ failures: retryable });
      this.logger.error({
        msg: 'Tiles deletion partially failed',
        totalTiles,
        uniqueFailureTypesCount: retryable.size,
        notFoundCount: notFound.size,
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
        notFoundCount: notFound.size,
        deletedCount,
        allTilesMissing: notFound.size === totalTiles,
      });
      return;
    }

    this.logger.info({ msg: 'Tiles deletion completed successfully', deletedCount: totalTiles });
  }

  private resolveStorageProvider<K extends StorageProvider>(
    params: Extract<TilesDeletionParams, { sourceProvider: K }>
  ): { provider: IStorageProvider<K>; storageTarget: string } {
    if (!(params.sourceProvider in this.storageProviders)) throw new UnrecoverableError(`Unsupported storage provider ${params.sourceProvider}`);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const storageProvider = this.storageProviders[params.sourceProvider];
    if (storageProvider === undefined) throw new UnrecoverableError(`Unsupported storage provider ${params.sourceProvider}`);
    const storageTarget = params.sourceProvider === SourceType.S3 ? this.s3Bucket : this.fsBasePath;
    this.logger.debug({ msg: `Using ${params.sourceProvider} provider` });
    return { provider: storageProvider, storageTarget };
  }

  private async deleteAllTiles(
    provider: IStorageProvider,
    storageTarget: string,
    params: TilesDeletionParams,
    totalTiles: number
  ): Promise<DeleteFailure> {
    const { jobId, taskId } = this.taskContext;
    let failures: DeleteFailure = new Map();
    const pendingBatches: string[][] = [];
    let batch: string[] = [];
    let processedTiles = 0;

    for (const tilePath of this.generateTilePaths(params)) {
      batch.push(tilePath);
      if (batch.length === this.batchSize) {
        pendingBatches.push(batch);
        batch = [];
        if (pendingBatches.length === this.concurrency) {
          const { batchFailures, processedTilesCount } = await this.flushBatches(provider, storageTarget, pendingBatches);
          processedTiles += processedTilesCount;
          failures = mergeFailures({ source: batchFailures, target: failures });
          const percentage = Math.round((processedTiles / totalTiles) * PERCENTAGE_COMPLETE);
          await this.queueClient.updateProgress(jobId, taskId, percentage);
          this.logger.info({ msg: 'Tiles deletion progress', deletionProgress: `${processedTiles}/${totalTiles}`, failedTiles: failures.size });
        }
      }
    }

    if (batch.length > 0) {
      pendingBatches.push(batch);
    }
    if (pendingBatches.length > 0) {
      const { batchFailures } = await this.flushBatches(provider, storageTarget, pendingBatches);
      failures = mergeFailures({ source: batchFailures, target: failures });
      this.logger.info({ msg: 'Tiles deletion progress', deletionProgress: `${processedTiles}/${totalTiles}`, failedTiles: failures.size });
    }

    return failures;
  }

  /**
   * Deletes all pending batches concurrently via Promise.allSettled.
   * Soft failures (entries returned by provider.delete with reason) and hard failures
   * (rejected promises — expanded into per-path failures with the thrown error as
   * the reason) are both collected so nothing is silently lost and every failed path
   * carries a cause the caller can surface in the task rejection reason.
   * pendingBatches is cleared in-place for reuse.
   *
   * @returns Total tile paths attempted (not necessarily deleted).
   */
  private async flushBatches(
    provider: IStorageProvider,
    storageTarget: string,
    pendingBatches: string[][]
  ): Promise<{ batchFailures: DeleteFailure; processedTilesCount: number }> {
    let failures: DeleteFailure = new Map();

    const processedTilesCount = pendingBatches.reduce((sum, b) => sum + b.length, 0);
    const results = await Promise.allSettled(pendingBatches.map(async (batch) => provider.delete(batch, storageTarget)));
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        failures = mergeFailures({ source: result.value.failures, target: failures });
      } else {
        const error: unknown = result.reason;
        const reason = describeError(error);
        this.logger.error({ msg: 'Batch delete threw unexpectedly', reason, error });
        const batch = pendingBatches[index] ?? [];
        const failure = failures.get(reason);
        failures.set(reason, { count: (failure?.count ?? 0) + batch.length, sample: failure?.sample ?? batch[0]! });
      }
    }
    pendingBatches.length = 0;
    return { batchFailures: failures, processedTilesCount };
  }

  /**
   * Calculates the total number of tiles across all ranges in the deletion params.
   * For each range, the tile count is the product of the width (maxX - minX + 1)
   * and height (maxY - minY + 1) of the range grid.
   */
  private countTiles(params: TilesDeletionParams): number {
    return params.ranges.reduce((sum, r) => sum + (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1), 0);
  }

  private *generateTilePaths(params: TilesDeletionParams): Generator<string> {
    for (const range of params.ranges) {
      yield* this.generateRangePaths(range, params.tilesPath, params.fileExtension);
    }
  }

  private *generateRangePaths(range: TileRange, tilesPath: string, fileExtension: string): Generator<string> {
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        yield `${tilesPath}/${range.zoom}/${x}/${y}.${fileExtension}`;
      }
    }
  }
}
