import { vi } from 'vitest';
import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import type { ConfigType } from '../../src/common/config';
import type { ITaskStrategy, StrategyFactory } from '../../src/cleaner/strategies';
import type { ErrorHandler } from '../../src/cleaner/errors';
import type { ErrorDecision, PollingPairConfig } from '../../src/cleaner/types';
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
}: {
  logger?: Logger;
  config?: ConfigType;
  queueClient?: QueueClient;
  strategyFactory?: StrategyFactory;
  errorHandler?: ErrorHandler;
  pollingPairs: PollingPairConfig[];
}): TaskPoller {
  return new TaskPoller(logger, config, queueClient, strategyFactory, errorHandler, pollingPairs);
}
