// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import Redis from 'ioredis';
import type { RedisHandle } from './redisContainer';
import { TINY_TILE_BODY } from './tileFixtures';

function createTestRedisClient(handle: RedisHandle): Redis {
  return new Redis({ host: handle.host, port: handle.port });
}

async function seedKeys(client: Redis, keys: string[]): Promise<void> {
  const pipeline = client.pipeline();
  for (const key of keys) {
    pipeline.set(key, TINY_TILE_BODY);
  }
  await pipeline.exec();
}

async function listAllKeys(client: Redis): Promise<string[]> {
  const keys = await client.keys('*');
  return keys.sort();
}

async function flush(client: Redis): Promise<void> {
  await client.flushdb();
}

export { createTestRedisClient, seedKeys, listAllKeys, flush };
