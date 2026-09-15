import type { Logger } from '@map-colonies/js-logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRedisConnection } from '@src/cleaner/storageProviders/redisClient';
import { createMockLogger, createRedisStorageConfig } from '../helpers/mocks';

const { redisConstructor, connect, quit, scan, unlink } = vi.hoisted(() => ({
  redisConstructor: vi.fn(),
  connect: vi.fn(),
  quit: vi.fn(),
  scan: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('ioredis', () => ({
  default: class {
    public connect = connect;
    public quit = quit;
    public scan = scan;
    public unlink = unlink;
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
    it('should return the connected client itself, not a wrapper', async () => {
      scan.mockResolvedValue(['0', []]);
      unlink.mockResolvedValue(1);

      const client = await createRedisConnection(createRedisStorageConfig(), mockLogger);
      await client.scan('0', 'MATCH', 'p-*', 'COUNT', 10);
      await client.unlink('k');

      expect(connect).toHaveBeenCalledTimes(1);
      expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'p-*', 'COUNT', 10);
      expect(unlink).toHaveBeenCalledWith('k');
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

    it('should hand back a client the shutdown hook can quit', async () => {
      const client = await createRedisConnection(createRedisStorageConfig(), mockLogger);
      await client.quit();

      expect(quit).toHaveBeenCalledTimes(1);
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
