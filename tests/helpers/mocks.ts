import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import type Redis from 'ioredis';
import { Registry } from 'prom-client';
import { vi, type Mock } from 'vitest';
import type { IStorageProvider, StorageProvider } from '@src/cleaner/storageProviders/iStorageProvider';
import type {
  FsConfig,
  FsStorageConfig,
  RedisConfig,
  RedisStorageConfig,
  S3Config,
  S3StorageConfig,
} from '@src/cleaner/storageProviders/storageConfig';
import type { ErrorHandler } from '../../src/cleaner/errors';
import { CleanerMetrics } from '../../src/cleaner/metrics';
import type { JobTrackerClient } from '../../src/cleaner/httpClients';
import { StrategyName, type ITaskStrategy, type StrategyFactory } from '../../src/cleaner/strategies';
import type { ErrorDecision, PollingPairConfig } from '../../src/cleaner/types';
import type { ConfigType } from '../../src/common/config';
import { TaskPoller } from '../../src/worker/taskPoller';

// ─── Logger ──────────────────────────────────────────────────────────────────

export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  } as unknown as Logger;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function createMockConfig(dequeueIntervalMs = 0): ConfigType {
  return { get: vi.fn().mockReturnValue(dequeueIntervalMs) } as unknown as ConfigType;
}

// ─── QueueClient ─────────────────────────────────────────────────────────────

export function createMockQueueClient(): QueueClient {
  return {
    dequeue: vi.fn().mockResolvedValue(null),
    ack: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as QueueClient;
}

// ─── Strategy ────────────────────────────────────────────────────────────────

export function buildMockStrategy(overrides: Partial<ITaskStrategy> = {}): ITaskStrategy {
  return {
    name: StrategyName.TILES_DELETION,
    validate: vi.fn().mockReturnValue({}),
    execute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── StrategyFactory ─────────────────────────────────────────────────────────

export function createMockStrategyFactory(): StrategyFactory {
  return { resolveWithContext: vi.fn() } as unknown as StrategyFactory;
}

// ─── ErrorHandler ────────────────────────────────────────────────────────────

export function createMockErrorHandler(defaultDecision: ErrorDecision = { shouldRetry: false, reason: 'test' }): ErrorHandler {
  return {
    handleError: vi.fn().mockReturnValue(defaultDecision),
  } as unknown as ErrorHandler;
}

// ─── StorageProvider ─────────────────────────────────────────────────────────

export function createMockStorageProvider<T extends StorageProvider = StorageProvider>(): Required<IStorageProvider<T>>;
export function createMockStorageProvider<T extends StorageProvider = StorageProvider>(options: { targetExists: false }): IStorageProvider<T>;
export function createMockStorageProvider<T extends StorageProvider = StorageProvider>({ targetExists = true } = {}): IStorageProvider<T> {
  return {
    delete: vi.fn().mockResolvedValue({ failures: new Map(), deletedCount: 0 }),
    deleteResources: vi.fn().mockResolvedValue({ failures: new Map(), deletedCount: 0 }),
    ...(targetExists && { targetExists: vi.fn().mockResolvedValue(true) }),
  };
}

// ─── Strategy Config (TilesDeletionStrategy) ─────────────────────────────────

export const TILES_DELETION_CONFIG_DEFAULTS = {
  batchSize: 100,
  concurrency: 2,
} as const;

export function createMockStrategyConfig(overrides: Record<string, unknown> = {}): ConfigType {
  const values: Record<string, unknown> = {
    'strategies.tilesDeletion.batchSize': TILES_DELETION_CONFIG_DEFAULTS.batchSize,
    'strategies.tilesDeletion.concurrency': TILES_DELETION_CONFIG_DEFAULTS.concurrency,
    ...overrides,
  };
  return { get: vi.fn().mockImplementation((key: string) => values[key]) } as unknown as ConfigType;
}

// ─── Strategy Config (DeleteStoredResourcesStrategy) ────────────────────────────

export const STORED_RESOURCES_DELETION_CONFIG_DEFAULTS = {} as const;

export function createMockStoredResourcesDeletionStrategyConfig(overrides: Record<string, unknown> = {}): ConfigType {
  const values: Record<string, unknown> = {
    ...overrides,
  };
  return { get: vi.fn().mockImplementation((key: string) => values[key]) } as unknown as ConfigType;
}

// ─── S3 Storage Config (S3StorageProvider) ───────────────────────────────────

export const S3_STORAGE_CONFIG_DEFAULTS = {
  delete: {
    batchSize: 100,
  },
  endpoint: 'http://localhost:9000',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  sslEnabled: false,
  forcePathStyle: true,
  region: 'us-east-1',
} as const satisfies S3Config;

export function createMockS3Config(overrides: Record<string, unknown> = {}): ConfigType {
  return {
    get: vi.fn().mockReturnValue({ ...S3_STORAGE_CONFIG_DEFAULTS, ...overrides }),
  } as unknown as ConfigType;
}

// ─── S3 Validated Storage Config ───────────────────────────────────

export const S3_VALIDATED_CONFIG_DEFAULTS = {
  endpoint: S3_STORAGE_CONFIG_DEFAULTS.endpoint,
  accessKeyId: S3_STORAGE_CONFIG_DEFAULTS.accessKeyId,
  secretAccessKey: S3_STORAGE_CONFIG_DEFAULTS.secretAccessKey,
  sslEnabled: S3_STORAGE_CONFIG_DEFAULTS.sslEnabled,
  forcePathStyle: S3_STORAGE_CONFIG_DEFAULTS.forcePathStyle,
  region: S3_STORAGE_CONFIG_DEFAULTS.region,
  batchSize: S3_STORAGE_CONFIG_DEFAULTS.delete.batchSize,
} as const satisfies S3StorageConfig;

export function createS3StorageConfig(overrides: Partial<S3StorageConfig> = {}): S3StorageConfig {
  return { ...S3_VALIDATED_CONFIG_DEFAULTS, ...overrides };
}

// ─── FS Storage Config (FsStorageProvider) ───────────────────────────────────

export const FS_STORAGE_CONFIG_DEFAULTS = {
  delete: {
    batchSize: 3,
  },
  basePath: '/test',
  subPaths: {
    tiles: 'artifacts/tiles',
  },
} as const satisfies FsConfig;

export function createMockFsConfig(overrides: Record<string, unknown> = {}): ConfigType {
  return {
    get: vi.fn().mockReturnValue({ ...FS_STORAGE_CONFIG_DEFAULTS, ...overrides }),
  } as unknown as ConfigType;
}

// ─── FS Validated Storage Config ───────────────────────────────────

export const FS_VALIDATED_CONFIG_DEFAULTS = {
  basePath: FS_STORAGE_CONFIG_DEFAULTS.basePath,
  subPaths: Object.values(FS_STORAGE_CONFIG_DEFAULTS.subPaths),
  batchSize: FS_STORAGE_CONFIG_DEFAULTS.delete.batchSize,
} as const satisfies FsStorageConfig;

export function createFsStorageConfig(overrides: Partial<FsStorageConfig> = {}): FsStorageConfig {
  return { ...FS_VALIDATED_CONFIG_DEFAULTS, ...overrides };
}

// ─── Redis Storage Config (RedisStorageProvider) ─────────────────────────────

export const REDIS_STORAGE_CONFIG_DEFAULTS = {
  delete: {
    batchSize: 3,
    scanCount: 10,
  },
  host: 'localhost',
  port: 6379,
  db: 0,
} as const satisfies RedisConfig;

export function createMockRedisConfig(overrides: Record<string, unknown> = {}): ConfigType {
  return {
    get: vi.fn().mockReturnValue({ ...REDIS_STORAGE_CONFIG_DEFAULTS, ...overrides }),
  } as unknown as ConfigType;
}

// ─── Redis Validated Storage Config ──────────────────────────────────────────

export const REDIS_VALIDATED_CONFIG_DEFAULTS = {
  host: REDIS_STORAGE_CONFIG_DEFAULTS.host,
  port: REDIS_STORAGE_CONFIG_DEFAULTS.port,
  db: REDIS_STORAGE_CONFIG_DEFAULTS.db,
  scanCount: REDIS_STORAGE_CONFIG_DEFAULTS.delete.scanCount,
  batchSize: REDIS_STORAGE_CONFIG_DEFAULTS.delete.batchSize,
} as const satisfies RedisStorageConfig;

export function createRedisStorageConfig(overrides: Partial<RedisStorageConfig> = {}): RedisStorageConfig {
  return { ...REDIS_VALIDATED_CONFIG_DEFAULTS, ...overrides };
}

// ─── Redis Client (RedisStorageProvider) ─────────────────────────────────────

/**
 * A mock Redis client recording every key it was asked to unlink. Cast at the boundary with `asRedis`;
 * RedisStorageProvider only ever touches `scan` and `unlink`.
 */
export interface MockRedisClient {
  unlinked: string[];
  scan: Mock;
  unlink: Mock;
}

export function createMockRedisClient(): MockRedisClient {
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

export function asRedis(client: MockRedisClient): Redis {
  return client as unknown as Redis;
}

/** A client whose SCAN walks `pages` in order, returning to cursor '0' only on the last one. */
export function createMockScanningRedisClient(pages: string[][]): MockRedisClient {
  const client = createMockRedisClient();
  let call = 0;
  client.scan = vi.fn().mockImplementation(async () => {
    const page = pages[call] ?? [];
    call += 1;
    const cursor = call >= pages.length ? '0' : String(call);
    return Promise.resolve([cursor, page] as [string, string[]]);
  });
  return client;
}

// ─── JobTrackerClient ─────────────────────────────────────────────────────────

export function createMockJobTrackerClient(): JobTrackerClient {
  return { notify: vi.fn().mockResolvedValue(undefined) } as unknown as JobTrackerClient;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/** Real metrics on an isolated registry, so tests can assert recorded values. */
export function createTestMetrics(): { metrics: CleanerMetrics; registry: Registry } {
  const registry = new Registry();
  return { metrics: new CleanerMetrics(registry), registry };
}

// ─── TaskPoller factory ───────────────────────────────────────────────────────

/**
 * Creates a TaskPoller with all typed mock dependencies.
 * All casting from mock types to the real SDK types is contained here.
 */
export function createTaskPoller({
  logger = createMockLogger(),
  config = createMockConfig(),
  queueClient = createMockQueueClient(),
  strategyFactory = createMockStrategyFactory(),
  errorHandler = createMockErrorHandler(),
  pollingPairs,
  jobTrackerClient = createMockJobTrackerClient(),
  metrics = createTestMetrics().metrics,
}: {
  logger?: Logger;
  config?: ConfigType;
  queueClient?: QueueClient;
  strategyFactory?: StrategyFactory;
  errorHandler?: ErrorHandler;
  pollingPairs: PollingPairConfig[];
  jobTrackerClient?: JobTrackerClient;
  metrics?: CleanerMetrics;
}): TaskPoller {
  return new TaskPoller(logger, config, queueClient, strategyFactory, errorHandler, pollingPairs, jobTrackerClient, metrics);
}
