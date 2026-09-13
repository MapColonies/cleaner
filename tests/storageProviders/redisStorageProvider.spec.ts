// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { RedisStorageProvider } from '@src/cleaner/storageProviders/redisStorageProvider';
import { createMockLogger, createRedisStorageConfig } from '../helpers/mocks';

/**
 * A fake Redis recording every key it was asked to unlink. Cast at the boundary like every
 * other mock in `tests/helpers/mocks.ts` — the provider only ever touches `scan` and `unlink`.
 */
interface FakeRedis {
  unlinked: string[];
  scan: Mock;
  unlink: Mock;
}

function createFakeClient(): FakeRedis {
  const unlinked: string[] = [];
  return {
    unlinked,
    scan: vi.fn().mockResolvedValue(['0', []]),
    unlink: vi.fn().mockImplementation(async (...keys: string[]) => {
      unlinked.push(...keys);
      return Promise.resolve(keys.length);
    }),
  };
}

function asRedis(fake: FakeRedis): Redis {
  return fake as unknown as Redis;
}

describe('RedisStorageProvider', () => {
  const config = createRedisStorageConfig({ batchSize: 3, scanCount: 2 });
  let client: FakeRedis;
  let provider: RedisStorageProvider;

  beforeEach(() => {
    client = createFakeClient();
    provider = new RedisStorageProvider(config, asRedis(client), createMockLogger());
  });

  describe('#delete', () => {
    it('should unlink every key and report how many were removed', async () => {
      const keys = ['p-1-1-1', 'p-1-1-2', 'p-1-2-1'];

      const result = await provider.delete('p', keys);

      expect(client.unlinked).toEqual(keys);
      expect(result.deletedCount).toBe(3);
      expect(result.failures.size).toBe(0);
    });

    it('should send one unlink per batchSize chunk', async () => {
      await provider.delete('p', ['a', 'b', 'c', 'd', 'e']);

      // batchSize is 3, so 5 keys means two commands.
      expect(client.unlink).toHaveBeenCalledTimes(2);
      expect(client.unlink).toHaveBeenNthCalledWith(1, 'a', 'b', 'c');
      expect(client.unlink).toHaveBeenNthCalledWith(2, 'd', 'e');
    });

    it('should report deletedCount 0 when the keys were already gone, rather than a failure', async () => {
      client.unlink = vi.fn().mockResolvedValue(0);

      const result = await provider.delete('p', ['missing-1-1-1']);

      expect(result.deletedCount).toBe(0);
      expect(result.failures.size).toBe(0);
    });

    it('should record a failed chunk against its reason without losing the rest', async () => {
      client.unlink = vi
        .fn()
        .mockRejectedValueOnce(new Error('READONLY'))
        .mockImplementation(async (...keys: string[]) => Promise.resolve(keys.length));

      const result = await provider.delete('p', ['a', 'b', 'c', 'd']);

      expect(result.failures.get('READONLY')).toEqual({ count: 3, sample: 'a' });
      expect(result.deletedCount).toBe(1);
    });

    it('should keep the first sample when two chunks fail for the same reason', async () => {
      client.unlink = vi.fn().mockRejectedValue(new Error('READONLY'));

      const result = await provider.delete('p', ['a', 'b', 'c', 'd']);

      expect(result.failures.get('READONLY')).toEqual({ count: 4, sample: 'a' });
      expect(result.deletedCount).toBe(0);
    });

    it('should return an empty result without touching Redis when given no keys', async () => {
      const result = await provider.delete('p', []);

      expect(client.unlink).not.toHaveBeenCalled();
      expect(result).toEqual({ failures: new Map(), deletedCount: 0 });
    });
  });
});
