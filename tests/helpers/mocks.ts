import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { vi } from 'vitest';
import type { FsConfig } from '@src/cleaner/storageProviders/fsStorageProvider';
import type { IStorageProvider, StorageProvider } from '@src/cleaner/storageProviders/iStorageProvider';
import type { S3Config } from '@src/cleaner/storageProviders/s3StorageProvider';
import type { ErrorHandler } from '../../src/cleaner/errors';
import type { JobTrackerClient } from '../../src/cleaner/httpClients';
import type { ITaskStrategy, StrategyFactory } from '../../src/cleaner/strategies';
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

export function createMockStorageProvider<T extends StorageProvider = StorageProvider>(): IStorageProvider<T> {
  return {
    delete: vi.fn().mockResolvedValue([]),
    deleteResources: vi.fn().mockResolvedValue({ failures: [] }),
    targetExists: vi.fn().mockResolvedValue(true),
  };
}

// ─── Strategy Config (TilesDeletionStrategy) ─────────────────────────────────

export const TILES_DELETION_CONFIG_DEFAULTS = {
  batchSize: 100,
  concurrency: 2,
  failureSampleSize: 3,
  s3Bucket: 'test-bucket',
  fsBasePath: '/test/tiles',
} as const;

export function createMockStrategyConfig(overrides: Record<string, unknown> = {}): ConfigType {
  const values: Record<string, unknown> = {
    'strategies.tilesDeletion.batchSize': TILES_DELETION_CONFIG_DEFAULTS.batchSize,
    'strategies.tilesDeletion.concurrency': TILES_DELETION_CONFIG_DEFAULTS.concurrency,
    'strategies.tilesDeletion.failureSampleSize': TILES_DELETION_CONFIG_DEFAULTS.failureSampleSize,
    'strategies.tilesDeletion.s3Bucket': TILES_DELETION_CONFIG_DEFAULTS.s3Bucket,
    'strategies.tilesDeletion.fsBasePath': TILES_DELETION_CONFIG_DEFAULTS.fsBasePath,
    ...overrides,
  };
  return { get: vi.fn().mockImplementation((key: string) => values[key]) } as unknown as ConfigType;
}

// ─── Strategy Config (DeleteStoredResourcesStrategy) ────────────────────────────

export const STORED_RESOURCES_DELETION_CONFIG_DEFAULTS = {
  failureSampleSize: 3,
} as const;

export function createMockStoredResourcesDeletionStrategyConfig(overrides: Record<string, unknown> = {}): ConfigType {
  const values: Record<string, unknown> = {
    'strategies.storedResourcesDeletion.failureSampleSize': STORED_RESOURCES_DELETION_CONFIG_DEFAULTS.failureSampleSize,
    ...overrides,
  };
  return { get: vi.fn().mockImplementation((key: string) => values[key]) } as unknown as ConfigType;
}

// ─── S3 Storage Config (S3StorageProvider) ───────────────────────────────────

export const S3_STORAGE_CONFIG_DEFAULTS = {
  endpoint: 'http://localhost:9000',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  sslEnabled: false,
  forcePathStyle: true,
  region: 'us-east-1',
} as const satisfies S3Config;

export function createMockS3Config(): ConfigType {
  return {
    get: vi.fn().mockReturnValue({ ...S3_STORAGE_CONFIG_DEFAULTS }),
  } as unknown as ConfigType;
}

// ─── FS Storage Config (FsStorageProvider) ───────────────────────────────────

export const FS_STORAGE_CONFIG_DEFAULTS = {
  basePath: '/test/tiles',
} as const satisfies FsConfig;

export function createMockFsConfig(): ConfigType {
  return {
    get: vi.fn().mockReturnValue({ ...FS_STORAGE_CONFIG_DEFAULTS }),
  } as unknown as ConfigType;
}

// ─── JobTrackerClient ─────────────────────────────────────────────────────────

export function createMockJobTrackerClient(): JobTrackerClient {
  return { notify: vi.fn().mockResolvedValue(undefined) } as unknown as JobTrackerClient;
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
}: {
  logger?: Logger;
  config?: ConfigType;
  queueClient?: QueueClient;
  strategyFactory?: StrategyFactory;
  errorHandler?: ErrorHandler;
  pollingPairs: PollingPairConfig[];
  jobTrackerClient?: JobTrackerClient;
}): TaskPoller {
  return new TaskPoller(logger, config, queueClient, strategyFactory, errorHandler, pollingPairs, jobTrackerClient);
}
