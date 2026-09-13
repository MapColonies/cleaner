import type { Logger } from '@map-colonies/js-logger';
import type { DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import type Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '@common/constants';
import { getChunk } from '@src/cleaner/utils';
import { describeError } from '../errors';
import type { DeleteFailure, DeleteResult, IStorageProvider, StorageProvider } from './iStorageProvider';
import type { RedisStorageConfig } from './storageConfig';

type RedisStorageProviderType = Extract<StorageProvider, 'REDIS'>;

@injectable()
export class RedisStorageProvider implements IStorageProvider<RedisStorageProviderType> {
  public constructor(
    @inject(SERVICES.REDIS_STORAGE_CONFIG) private readonly redisConfig: RedisStorageConfig,
    @inject(SERVICES.REDIS_CONNECTION) private readonly client: Redis,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.logger.debug({
      msg: 'Loaded Redis storage provider',
      host: redisConfig.host,
      port: redisConfig.port,
      batchSize: redisConfig.batchSize,
    });
  }

  public async delete(prefix: string, keys: string[]): Promise<DeleteResult> {
    if (keys.length === 0) {
      return { failures: new Map(), deletedCount: 0 };
    }

    this.logger.info({ msg: 'Deleting keys from Redis', prefix, keysCount: keys.length });
    return this.unlinkInBatches(keys);
  }

  public async deleteResources(params: Extract<DeleteStoredResourcesParams, { storageProvider: RedisStorageProviderType }>): Promise<DeleteResult> {
    return Promise.reject(new Error(`Not implemented: deleteResources for ${params.prefix}`));
  }

  public async targetExists(prefix: string, relativePath: string): Promise<boolean> {
    return Promise.reject(new Error(`Not implemented: targetExists for ${prefix}${relativePath}`));
  }

  /**
   * One multi-key `UNLINK` per chunk, summing what Redis reports it removed.
   *
   * A chunk that throws is recorded whole against its reason: the command is atomic, so
   * nothing in it was removed, and Redis gives no per-key attribution to do better.
   */
  private async unlinkInBatches(keys: string[]): Promise<DeleteResult> {
    const failures: DeleteFailure = new Map();
    let deletedCount = 0;

    for (const chunk of getChunk(keys, this.redisConfig.batchSize)) {
      try {
        deletedCount += await this.client.unlink(...chunk);
      } catch (error) {
        const reason = describeError(error);
        this.logger.error({ msg: 'Unlink chunk failed', reason, keysCount: chunk.length, err: error });
        const failure = failures.get(reason);
        failures.set(reason, { count: (failure?.count ?? 0) + chunk.length, sample: failure?.sample ?? chunk[0]! });
      }
    }

    return { failures, deletedCount };
  }
}
