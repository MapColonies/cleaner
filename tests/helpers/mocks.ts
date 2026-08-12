import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { vi } from 'vitest';
import type { IStorageProvider, StorageProvider } from '@src/cleaner/storageProviders/iStorageProvider';
import type { FsConfig, FsStorageConfig, S3Config, S3StorageConfig } from '@src/cleaner/storageProviders/storageConfig';
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
    delete: vi.fn().mockResolvedValue({ failures: new Map() }),
    deleteResources: vi.fn().mockResolvedValue({ failures: new Map() }),
    targetExists: vi.fn().mockResolvedValue(true),
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
