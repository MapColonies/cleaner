import { vi } from 'vitest';
import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import type { ConfigType } from '../../src/common/config';
import type { ITaskStrategy, StrategyFactory } from '../../src/cleaner/strategies';
import type { IStorageProvider } from '../../src/cleaner/storageProviders';
import type { ErrorHandler } from '../../src/cleaner/errors';
import type { ErrorDecision, PollingPairConfig } from '../../src/cleaner/types';
import type { JobTrackerClient } from '../../src/cleaner/httpClients';
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

export function createMockStorageProvider(): IStorageProvider {
  return {
    delete: vi.fn().mockResolvedValue([]),
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

// ─── S3 Storage Config (S3StorageProvider) ───────────────────────────────────

export const S3_STORAGE_CONFIG_DEFAULTS = {
  endpoint: 'http://localhost:9000',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  sslEnabled: false,
  forcePathStyle: true,
  region: 'us-east-1',
} as const;

export function createMockS3Config(): ConfigType {
  return {
    get: vi.fn().mockReturnValue({ ...S3_STORAGE_CONFIG_DEFAULTS }),
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
