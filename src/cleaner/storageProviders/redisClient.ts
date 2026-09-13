import type { Logger } from '@map-colonies/js-logger';
// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import Redis from 'ioredis';
import type { RedisStorageConfig } from './storageConfig';

/**
 * Connects to a standalone Redis.
 *
 * The Redis connection is a long-lived socket: it is opened here at startup so a bad host or
 * credential fails the service at boot rather than on the first task, and closed by the
 * `onSignal` shutdown hook.
 */
export async function createRedisConnection(config: RedisStorageConfig, logger: Logger): Promise<Redis> {
  const client = new Redis({
    host: config.host,
    port: config.port,
    db: config.db,
    username: config.username,
    password: config.password,
    lazyConnect: true,
    ...(config.tlsEnabled === true && { tls: {} }),
  });

  await client.connect();

  logger.info({ msg: 'Connected to Redis', host: config.host, port: config.port, db: config.db });

  return client;
}
