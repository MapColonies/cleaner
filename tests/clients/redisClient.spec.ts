import type { Logger } from '@map-colonies/js-logger';
// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRedisConnection } from '@src/cleaner/clients/redisClient';
import { createMockLogger, createRedisStorageConfig } from '../helpers/mocks';

const { redisConstructor, connect, quit } = vi.hoisted(() => ({
  redisConstructor: vi.fn(),
  connect: vi.fn(),
  quit: vi.fn(),
}));

vi.mock('ioredis', () => ({
  default: class {
    public connect = connect;
    public quit = quit;
    public constructor(options: unknown) {
      redisConstructor(options);
    }
  },
}));

describe('createRedisConnection', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    connect.mockResolvedValue(undefined);
    quit.mockResolvedValue('OK');
  });

  describe('connecting', () => {
    it('should connect once at startup and return the connected Redis client', async () => {
      const client = await createRedisConnection(createRedisStorageConfig(), mockLogger);

      expect(connect).toHaveBeenCalledTimes(1);
      expect(client).toBeInstanceOf(Redis);
    });

    it('should build the client lazily with the configured connection details', async () => {
      await createRedisConnection(createRedisStorageConfig({ host: 'redis.local', port: 6380, db: 2 }), mockLogger);

      expect(redisConstructor).toHaveBeenCalledWith(expect.objectContaining({ host: 'redis.local', port: 6380, db: 2, lazyConnect: true }));
    });

    it('should pass credentials through to the client', async () => {
      await createRedisConnection(createRedisStorageConfig({ username: 'user', password: 'secret' }), mockLogger);

      expect(redisConstructor).toHaveBeenCalledWith(expect.objectContaining({ username: 'user', password: 'secret' }));
    });

    it('should enable tls when configured', async () => {
      await createRedisConnection(createRedisStorageConfig({ tlsEnabled: true }), mockLogger);

      expect(redisConstructor).toHaveBeenCalledWith(expect.objectContaining({ tls: {} }));
    });
  });

  describe('connection failure', () => {
    it('should propagate the error so startup fails fast rather than on the first task', async () => {
      connect.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(createRedisConnection(createRedisStorageConfig(), mockLogger)).rejects.toThrow('ECONNREFUSED');
    });

    it('should not hand back a connection when connect failed', async () => {
      connect.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(createRedisConnection(createRedisStorageConfig(), mockLogger)).rejects.toThrow();

      expect(quit).not.toHaveBeenCalled();
    });
  });
});
