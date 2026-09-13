import type { Logger } from '@map-colonies/js-logger';
import type { DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import type Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '@common/constants';
import { getChunk } from '@src/cleaner/utils';
import { describeError } from '../errors';
import { mergeFailures } from './failuresHandling';
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
    const pattern = this.matchPattern(params.prefix);
    this.logger.info({ msg: 'Starting Redis prefix wipe', prefix: params.prefix, pattern });

    let failures: DeleteFailure = new Map();
    let deletedCount = 0;

    for await (const keys of this.scanKeys(pattern)) {
      if (keys.length === 0) {
        continue;
      }
      const result = await this.unlinkInBatches(keys);
      failures = mergeFailures({ source: result.failures, target: failures });
      deletedCount += result.deletedCount;
    }

    this.logger.info({ msg: 'Completed Redis prefix wipe', prefix: params.prefix, deletedCount, failedReasons: failures.size });
    return { failures, deletedCount };
  }

  public async targetExists(prefix: string, relativePath: string): Promise<boolean> {
    for await (const keys of this.scanKeys(this.matchPattern(prefix))) {
      if (keys.length > 0) {
        return true;
      }
    }

    return false;
  }

  private matchPattern(prefix: string): string {
    return `${prefix}-*`;
  }

  /**
   * Walks the keyspace a page at a time, so nothing is buffered whole.
   *
   * `MATCH` filters after retrieval, so a page can come back empty while keys still remain.
   * The loop therefore ends on the cursor returning to '0', never on an empty page.
   */
  private async *scanKeys(pattern: string): AsyncGenerator<string[]> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', this.redisConfig.scanCount);
      cursor = nextCursor;
      yield keys;
    } while (cursor !== '0');
  }

  /**
   * One multi-key `UNLINK` per chunk, summing what Redis reports it removed.
   *
   * A chunk that throws is recorded whole against its reason: the command is atomic, so
   * nothing in it was removed, and Redis gives no per-key attribution to do better.
   */
  private async unlinkInBatches(keys: string[]): Promise<Required<DeleteResult>> {
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
