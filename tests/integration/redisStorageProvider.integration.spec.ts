// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import type Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRedisConnection, RedisStorageProvider, type RedisStorageConfig } from '@src/cleaner/storageProviders';
import { createMockLogger } from '../helpers/mocks';
import { startRedis, type RedisHandle } from './helpers/redisContainer';
import { createTestRedisClient, flush, listAllKeys, seedKeys } from './helpers/redisTestKit';

const PREFIX = 'eli_test-Orthophoto-redis_WorldCRS84';
const OTHER_PREFIX = 'eli_test3-Orthophoto-redis_WorldCRS84';

describe('RedisStorageProvider against a real server', () => {
  let handle: RedisHandle;
  let client: Redis;
  let connection: Redis;
  let provider: RedisStorageProvider;

  beforeAll(async () => {
    handle = await startRedis();
    client = createTestRedisClient(handle);
    // Small paging values so a 50-key test crosses both SCAN and UNLINK boundaries
    const config: RedisStorageConfig = { host: handle.host, port: handle.port, db: 0, scanCount: 10, batchSize: 4 };
    connection = await createRedisConnection(config, createMockLogger());
    provider = new RedisStorageProvider(config, connection, createMockLogger());
  });

  afterAll(async () => {
    await connection.quit();
    client.disconnect();
    await handle.stop();
  });

  afterEach(async () => {
    await flush(client);
  });

  describe('#delete', () => {
    it('should delete exactly the listed keys and leave the rest of the layer intact', async () => {
      const target = [`${PREFIX}-10-1227-704`, `${PREFIX}-10-1227-705`];
      const survivors = [`${PREFIX}-10-1228-704`, `${OTHER_PREFIX}-10-1227-704`];
      await seedKeys(client, [...target, ...survivors]);

      const result = await provider.delete(PREFIX, target);

      expect(result.deletedCount).toBe(2);
      expect(await listAllKeys(client)).toEqual(survivors.sort());
    });

    it('should treat unlinking absent keys as a clean no-op', async () => {
      const result = await provider.delete(PREFIX, [`${PREFIX}-9-1-1`, `${PREFIX}-9-1-2`]);

      expect(result).toEqual({ failures: new Map(), deletedCount: 0 });
    });
  });

  describe('#deleteResources', () => {
    it('should wipe the whole prefix without touching a second layer', async () => {
      const mine = [`${PREFIX}-10-1227-704`, `${PREFIX}-11-2454-1408`, `${PREFIX}-11-2454-1409`];
      const theirs = [`${OTHER_PREFIX}-10-1227-704`];
      await seedKeys(client, [...mine, ...theirs]);

      const result = await provider.deleteResources({ storageProvider: 'REDIS', prefix: PREFIX });

      expect(result.deletedCount).toBe(3);
      expect(await listAllKeys(client)).toEqual(theirs);
    });

    it('should page through a keyspace larger than scanCount and batchSize', async () => {
      const keys = Array.from({ length: 50 }, (_, i) => `${PREFIX}-12-4892-${i}`);
      await seedKeys(client, keys);

      const result = await provider.deleteResources({ storageProvider: 'REDIS', prefix: PREFIX });

      expect(result.deletedCount).toBe(50);
      expect(await listAllKeys(client)).toEqual([]);
    });

    it('should report a cold cache as zero deletions rather than an error', async () => {
      const result = await provider.deleteResources({ storageProvider: 'REDIS', prefix: PREFIX });

      expect(result).toEqual({ failures: new Map(), deletedCount: 0 });
    });
  });
});
