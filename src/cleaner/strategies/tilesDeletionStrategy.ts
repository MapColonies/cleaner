import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import { tilesDeletionParamsSchema, type TilesDeletionParams, type TileRange } from '../validation/schemas';
import { validateSchema } from '../utils';
import { RecoverableError, UnrecoverableError } from '../errors';
import type { IStorageProvider } from '../storageProviders';
import type { ITaskStrategy } from './taskStrategy';

@injectable()
export class TilesDeletionStrategy implements ITaskStrategy<TilesDeletionParams> {
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly failureSampleSize: number;
  private readonly s3Bucket: string;
  private readonly fsBasePath: string;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.STORAGE_PROVIDERS) private readonly storageProviders: Map<string, IStorageProvider>
  ) {
    this.batchSize = config.get('strategies.tilesDeletion.batchSize') as unknown as number;
    this.concurrency = config.get('strategies.tilesDeletion.concurrency') as unknown as number;
    this.failureSampleSize = config.get('strategies.tilesDeletion.failureSampleSize') as unknown as number;
    this.s3Bucket = config.get('strategies.tilesDeletion.s3Bucket') as unknown as string;
    this.fsBasePath = config.get('strategies.tilesDeletion.fsBasePath') as unknown as string;
  }

  public validate(params: unknown): TilesDeletionParams {
    return validateSchema(tilesDeletionParamsSchema, params, this.logger);
  }

  public async execute(params: TilesDeletionParams): Promise<void> {
    const { provider, storageTarget } = this.resolveProvider(params);

    this.logger.info({ msg: 'Starting tiles deletion', provider: params.provider, storageTarget, rangeCount: params.ranges.length });

    const failedPaths = await this.deleteAllTiles(provider, storageTarget, params);

    if (failedPaths.length > 0) {
      const sample = failedPaths.slice(0, this.failureSampleSize);
      this.logger.warn({ msg: 'Tiles deletion partially failed', failedCount: failedPaths.length, sample });
      throw new RecoverableError(`Failed to delete ${failedPaths.length} tiles. Sample: ${sample.join(', ')}`);
    }

    this.logger.info({ msg: 'Tiles deletion completed successfully' });
  }

  private resolveProvider(params: TilesDeletionParams): { provider: IStorageProvider; storageTarget: string } {
    const provider = this.storageProviders.get(params.provider);
    if (provider === undefined) {
      throw new UnrecoverableError(`Unknown storage provider: ${params.provider}`);
    }
    const storageTarget = params.provider === 'S3' ? this.s3Bucket : this.fsBasePath;
    return { provider, storageTarget };
  }

  private async deleteAllTiles(provider: IStorageProvider, storageTarget: string, params: TilesDeletionParams): Promise<string[]> {
    const failedPaths: string[] = [];
    const pendingBatches: string[][] = [];
    let batch: string[] = [];

    for (const tilePath of this.generateTilePaths(params)) {
      batch.push(tilePath);
      if (batch.length === this.batchSize) {
        pendingBatches.push(batch);
        batch = [];
        if (pendingBatches.length === this.concurrency) {
          await this.flushBatches(provider, storageTarget, pendingBatches, failedPaths);
        }
      }
    }

    if (batch.length > 0) {
      pendingBatches.push(batch);
    }
    if (pendingBatches.length > 0) {
      await this.flushBatches(provider, storageTarget, pendingBatches, failedPaths);
    }

    return failedPaths;
  }

  private async flushBatches(provider: IStorageProvider, storageTarget: string, pendingBatches: string[][], failedPaths: string[]): Promise<void> {
    const results = await Promise.allSettled(pendingBatches.map(async (batch) => provider.delete(batch, storageTarget)));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        failedPaths.push(...result.value);
      } else {
        this.logger.error({ msg: 'Batch delete threw unexpectedly', error: result.reason });
      }
    }
    pendingBatches.length = 0;
  }

  private *generateTilePaths(params: TilesDeletionParams): Generator<string> {
    for (const range of params.ranges) {
      yield* this.generateRangePaths(range, params.tilesPath, params.fileExtension);
    }
  }

  private *generateRangePaths(range: TileRange, tilesPath: string, fileExtension: string): Generator<string> {
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        yield `${tilesPath}/${range.zoom}/${x}/${y}${fileExtension}`;
      }
    }
  }
}
