# Cleaner Worker Implementation Plan

## Incremental Commit & PR Workflow

**IMPORTANT**: This implementation should be done incrementally with small commits grouped into reviewable PRs.

### Workflow Instructions

1. **Small Commits**: Implement one logical piece at a time
2. **Stage Files**: After implementing each part, stage the files using `git add`
3. **Review Checkpoint**: Stop and wait for user confirmation before committing
4. **Commit on Approval**: Only commit changes after user explicitly approves
5. **Follow Conventional Commits**: Use the format `<type>(<scope>): <description>` (see `ai-docs/git-workflow.md`)
6. **PR Creation**: When enough commits are accumulated (usually 3-5 related commits), STOP and tell the user it's time to create a PR. Wait for the user to create PR and start a new branch before continuing.

### Suggested Commit & PR Breakdown

This plan contains 15 steps. Suggested grouping:

**PR 1: Foundation** (Steps 1-3)

- Commit 1: Install dependencies
- Commit 2: Update configuration
- Commit 3: Update constants

**PR 2: Core Types** (Steps 4-5)

- Commit 1: Create error classes and tests
- Commit 2: Create types

**PR 3: Validation Layer** (Step 6)

- Commit 1: Create validation schemas and validator with tests

**PR 4: Strategy Pattern** (Step 7)

- Commit 1: Create strategy interface and tiles deletion strategy
- Commit 2: Create strategy factory
- Commit 3: Add tests for strategies

**PR 5: Error Handling** (Step 8)

- Commit 1: Create error handler with tests

**PR 6: Task Polling** (Step 9)

- Commit 1: Create TaskPoller with tests

**PR 7: Integration** (Steps 10-12)

- Commit 1: Update container config
- Commit 2: Update index.ts
- Commit 3: Remove demo code

**PR 8: Final Cleanup** (Steps 13-15)

- Commit 1: Run verification commands
- Commit 2: Fix any issues found

Or follow the user's preferred breakdown.

## Overview

This plan implements a task polling system for the Cleaner worker service using `@map-colonies/mc-priority-queue` instead of `@map-colonies/jobnik-sdk`. The jobnik-sdk code will be commented out (not deleted) for future migration.

### Architecture Summary

- **TaskPoller**: Main polling loop - polls job/task pairs from config
- **TaskValidator**: Validates task parameters with Zod schemas
- **StrategyFactory**: Resolves strategy classes by taskType
- **ITaskStrategy**: Interface for task execution strategies
- **TilesDeletionStrategy**: Concrete strategy for tiles-deletion tasks
- **ErrorHandler**: Centralized error handling with metrics/logging
- **Custom Errors**: RecoverableError, UnrecoverableError

### Design Decisions

| Aspect                 | Decision                             |
| ---------------------- | ------------------------------------ |
| Polling                | Round-robin through configured pairs |
| Strategy mapping       | By taskType only                     |
| Strategy instantiation | Factory using tsyringe               |
| Validation failure     | Reject unrecoverable                 |
| Error categories       | 2 (Recoverable, Unrecoverable)       |
| Ack/Reject             | Handled in TaskPoller                |
| Max attempts           | Per-pair in config                   |

---

## Prerequisites

- Node.js >= 24.0.0
- npm >= 10.x

---

## Step 1: Install Dependencies

Run the following command:

```bash
npm install @map-colonies/mc-priority-queue @map-colonies/mc-utils zod --legacy-peer-deps
```

---

## Step 2: Update Configuration

### File: `config/default.json`

Replace the entire file with:

```json
{
  "telemetry": {
    "metrics": {},
    "tracing": {
      "isEnabled": false
    },
    "shared": {},
    "logger": {
      "level": "info",
      "prettyPrint": false
    }
  },
  "server": {
    "port": 8080
  },
  "queue": {
    "jobManagerBaseUrl": "http://job-manager:8080",
    "heartbeatBaseUrl": "http://heartbeat:8080",
    "heartbeatIntervalMs": 1000
  },
  "polling": {
    "dequeueIntervalMs": 3000,
    "pairs": [
      {
        "jobType": "Ingestion_Update",
        "taskType": "tiles-deletion",
        "maxAttempts": 3
      }
    ]
  },
  "httpRetry": {
    "attempts": 3,
    "delay": "exponential",
    "shouldResetTimeout": true
  }
}
```

---

## Step 3: Update Constants

### File: `src/common/constants.ts`

Replace the entire file with:

```typescript
import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_worker';
export const DEFAULT_SERVER_PORT = 8080;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METRICS: Symbol('METRICS'),
  QUEUE_CLIENT: Symbol('QueueClient'),
  TASK_POLLER: Symbol('TaskPoller'),
  STRATEGY_FACTORY: Symbol('StrategyFactory'),
  TASK_VALIDATOR: Symbol('TaskValidator'),
  ERROR_HANDLER: Symbol('ErrorHandler'),
  // =============================================================================
  // TODO: When we move to the new job-manager, we will use @map-colonies/jobnik-sdk
  // The tokens below are kept for future migration.
  // =============================================================================
  JOBNIK_SDK: Symbol('JobnikSDK'),
  WORKER: Symbol('Worker'),
} satisfies Record<string, symbol>;
/* eslint-enable @typescript-eslint/naming-convention */

// Strategy tokens - add new strategies here
/* eslint-disable @typescript-eslint/naming-convention */
export const STRATEGY_TOKENS = {
  TILES_DELETION: Symbol('TilesDeletionStrategy'),
} satisfies Record<string, symbol>;
/* eslint-enable @typescript-eslint/naming-convention */
```

---

## Step 4: Create Error Classes

### File: `src/cleaner/errors/errors.ts`

Create directory `src/cleaner/errors/` and create file:

```typescript
/**
 * Base class for recoverable errors.
 * Tasks that fail with this error will be retried (if attempts < maxAttempts).
 */
export class RecoverableError extends Error {
  public readonly isRecoverable = true;

  public constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RecoverableError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Base class for unrecoverable errors.
 * Tasks that fail with this error will NOT be retried.
 */
export class UnrecoverableError extends Error {
  public readonly isRecoverable = false;

  public constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'UnrecoverableError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when task parameter validation fails.
 * Always unrecoverable - bad data won't fix itself.
 */
export class ValidationError extends UnrecoverableError {
  public constructor(
    message: string,
    public readonly validationErrors?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Thrown when no strategy is found for a task type.
 * Always unrecoverable - configuration issue.
 */
export class StrategyNotFoundError extends UnrecoverableError {
  public constructor(taskType: string) {
    super(`No strategy found for task type: ${taskType}`);
    this.name = 'StrategyNotFoundError';
  }
}

/**
 * Type guard to check if an error is recoverable.
 */
export function isRecoverableError(error: unknown): error is RecoverableError {
  return error instanceof Error && 'isRecoverable' in error && error.isRecoverable === true;
}

/**
 * Type guard to check if an error is unrecoverable.
 */
export function isUnrecoverableError(error: unknown): error is UnrecoverableError {
  return error instanceof Error && 'isRecoverable' in error && error.isRecoverable === false;
}
```

### File: `src/cleaner/errors/index.ts`

```typescript
export { RecoverableError, UnrecoverableError, ValidationError, StrategyNotFoundError, isRecoverableError, isUnrecoverableError } from './errors';
```

### Test File: `tests/errors.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  RecoverableError,
  UnrecoverableError,
  ValidationError,
  StrategyNotFoundError,
  isRecoverableError,
  isUnrecoverableError,
} from '@src/cleaner/errors';

describe('Error Classes', () => {
  describe('RecoverableError', () => {
    it('should create error with message', () => {
      const error = new RecoverableError('Something went wrong');

      expect(error.message).toBe('Something went wrong');
      expect(error.name).toBe('RecoverableError');
      expect(error.isRecoverable).toBe(true);
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new RecoverableError('Wrapped error', cause);

      expect(error.cause).toBe(cause);
    });

    it('should be instance of Error', () => {
      const error = new RecoverableError('Test');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RecoverableError);
    });
  });

  describe('UnrecoverableError', () => {
    it('should create error with message', () => {
      const error = new UnrecoverableError('Fatal error');

      expect(error.message).toBe('Fatal error');
      expect(error.name).toBe('UnrecoverableError');
      expect(error.isRecoverable).toBe(false);
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new UnrecoverableError('Wrapped error', cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('ValidationError', () => {
    it('should create error with message', () => {
      const error = new ValidationError('Invalid parameters');

      expect(error.message).toBe('Invalid parameters');
      expect(error.name).toBe('ValidationError');
      expect(error.isRecoverable).toBe(false);
    });

    it('should create error with validation errors', () => {
      const validationErrors = [{ field: 'path', message: 'required' }];
      const error = new ValidationError('Invalid parameters', validationErrors);

      expect(error.validationErrors).toEqual(validationErrors);
    });

    it('should be instance of UnrecoverableError', () => {
      const error = new ValidationError('Test');

      expect(error).toBeInstanceOf(UnrecoverableError);
    });
  });

  describe('StrategyNotFoundError', () => {
    it('should create error with task type in message', () => {
      const error = new StrategyNotFoundError('unknown-task');

      expect(error.message).toBe('No strategy found for task type: unknown-task');
      expect(error.name).toBe('StrategyNotFoundError');
      expect(error.isRecoverable).toBe(false);
    });
  });

  describe('isRecoverableError', () => {
    it('should return true for RecoverableError', () => {
      const error = new RecoverableError('Test');

      expect(isRecoverableError(error)).toBe(true);
    });

    it('should return false for UnrecoverableError', () => {
      const error = new UnrecoverableError('Test');

      expect(isRecoverableError(error)).toBe(false);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Test');

      expect(isRecoverableError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isRecoverableError(null)).toBe(false);
      expect(isRecoverableError(undefined)).toBe(false);
      expect(isRecoverableError('string')).toBe(false);
    });
  });

  describe('isUnrecoverableError', () => {
    it('should return true for UnrecoverableError', () => {
      const error = new UnrecoverableError('Test');

      expect(isUnrecoverableError(error)).toBe(true);
    });

    it('should return true for ValidationError', () => {
      const error = new ValidationError('Test');

      expect(isUnrecoverableError(error)).toBe(true);
    });

    it('should return false for RecoverableError', () => {
      const error = new RecoverableError('Test');

      expect(isUnrecoverableError(error)).toBe(false);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Test');

      expect(isUnrecoverableError(error)).toBe(false);
    });
  });
});
```

---

## Step 5: Create Types

### File: `src/cleaner/types.ts`

```typescript
import type { ITaskResponse } from '@map-colonies/mc-priority-queue';

/**
 * Configuration for a polling job/task pair.
 */
export interface PollingPairConfig {
  jobType: string;
  taskType: string;
  maxAttempts: number;
}

/**
 * Configuration for the polling system.
 */
export interface PollingConfig {
  dequeueIntervalMs: number;
  pairs: PollingPairConfig[];
}

/**
 * Configuration for the queue client.
 */
export interface QueueConfig {
  jobManagerBaseUrl: string;
  heartbeatBaseUrl: string;
  heartbeatIntervalMs: number;
}

/**
 * HTTP retry configuration.
 */
export interface HttpRetryConfig {
  attempts: number;
  delay: 'exponential' | number;
  shouldResetTimeout: boolean;
}

/**
 * Context passed to error handler.
 */
export interface ErrorContext {
  jobType: string;
  taskType: string;
  taskId: string;
  jobId: string;
  attempts: number;
  maxAttempts: number;
}

/**
 * Decision made by error handler.
 */
export interface ErrorDecision {
  isRecoverable: boolean;
  reason: string;
  shouldLog: boolean;
  logLevel: 'error' | 'warn' | 'info';
}

/**
 * Generic task response type alias for convenience.
 */
export type TaskResponse<T = unknown> = ITaskResponse<T>;
```

---

## Step 6: Create Validation

### File: `src/cleaner/validation/schemas.ts`

```typescript
import { z } from 'zod';

/**
 * Schema registry - maps taskType to its Zod schema.
 * Add new schemas here as new task types are added.
 */
export const taskSchemas: Record<string, z.ZodSchema> = {
  // Placeholder schema for tiles-deletion - to be defined later
  'tiles-deletion': z.object({}).passthrough(),
};

/**
 * Get schema for a task type.
 * Returns a passthrough schema if no specific schema is defined.
 */
export function getSchemaForTaskType(taskType: string): z.ZodSchema {
  return taskSchemas[taskType] ?? z.object({}).passthrough();
}
```

### File: `src/cleaner/validation/index.ts`

```typescript
import { injectable } from 'tsyringe';
import type { z } from 'zod';
import { ValidationError } from '../errors';
import { getSchemaForTaskType } from './schemas';

@injectable()
export class TaskValidator {
  /**
   * Validates task parameters against the schema for the given task type.
   * @throws {ValidationError} if validation fails
   */
  public validate<T>(taskType: string, parameters: unknown): T {
    const schema = getSchemaForTaskType(taskType);

    const result = schema.safeParse(parameters);

    if (!result.success) {
      throw new ValidationError(`Validation failed for task type "${taskType}": ${result.error.message}`, result.error.errors);
    }

    return result.data as T;
  }

  /**
   * Checks if a schema exists for the given task type.
   */
  public hasSchema(taskType: string): boolean {
    return taskType in getSchemaForTaskType(taskType);
  }

  /**
   * Gets the schema for a task type.
   */
  public getSchema(taskType: string): z.ZodSchema {
    return getSchemaForTaskType(taskType);
  }
}

export { getSchemaForTaskType, taskSchemas } from './schemas';
```

### Test File: `tests/taskValidator.spec.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { TaskValidator, taskSchemas } from '@src/cleaner/validation';
import { ValidationError } from '@src/cleaner/errors';

describe('TaskValidator', () => {
  let validator: TaskValidator;

  beforeEach(() => {
    validator = new TaskValidator();
  });

  describe('validate', () => {
    it('should pass validation for valid parameters with passthrough schema', () => {
      const parameters = { anyField: 'anyValue', number: 123 };

      const result = validator.validate('tiles-deletion', parameters);

      expect(result).toEqual(parameters);
    });

    it('should pass validation for empty object with passthrough schema', () => {
      const parameters = {};

      const result = validator.validate('tiles-deletion', parameters);

      expect(result).toEqual(parameters);
    });

    it('should pass validation for unknown task type with passthrough schema', () => {
      const parameters = { foo: 'bar' };

      const result = validator.validate('unknown-task', parameters);

      expect(result).toEqual(parameters);
    });

    it('should throw ValidationError when validation fails', () => {
      // Temporarily add a strict schema for testing
      const originalSchema = taskSchemas['tiles-deletion'];
      taskSchemas['tiles-deletion'] = z.object({
        requiredField: z.string(),
      });

      try {
        expect(() => validator.validate('tiles-deletion', {})).toThrow(ValidationError);
      } finally {
        // Restore original schema
        taskSchemas['tiles-deletion'] = originalSchema;
      }
    });

    it('should include validation errors in thrown ValidationError', () => {
      const originalSchema = taskSchemas['tiles-deletion'];
      taskSchemas['tiles-deletion'] = z.object({
        requiredField: z.string(),
      });

      try {
        expect(() => validator.validate('tiles-deletion', {})).toThrow(
          expect.objectContaining({
            name: 'ValidationError',
            validationErrors: expect.any(Array),
          })
        );
      } finally {
        taskSchemas['tiles-deletion'] = originalSchema;
      }
    });
  });

  describe('getSchema', () => {
    it('should return schema for known task type', () => {
      const schema = validator.getSchema('tiles-deletion');

      expect(schema).toBeDefined();
      expect(typeof schema.safeParse).toBe('function');
    });

    it('should return passthrough schema for unknown task type', () => {
      const schema = validator.getSchema('unknown-task');

      expect(schema).toBeDefined();
      const result = schema.safeParse({ any: 'data' });
      expect(result.success).toBe(true);
    });
  });
});
```

---

## Step 7: Create Strategy Interface and TilesDeletionStrategy

### File: `src/cleaner/strategies/taskStrategy.ts`

```typescript
import type { ITaskResponse } from '@map-colonies/mc-priority-queue';

/**
 * Interface for task execution strategies.
 * Each task type should have a corresponding strategy implementation.
 */
export interface ITaskStrategy<TParams = unknown> {
  /**
   * Executes the task logic.
   * @param task - The task to execute
   * @throws {RecoverableError} for transient failures that should be retried
   * @throws {UnrecoverableError} for permanent failures that should not be retried
   */
  execute(task: ITaskResponse<TParams>): Promise<void>;
}
```

### File: `src/cleaner/strategies/tilesDeletionStrategy.ts`

```typescript
import type { Logger } from '@map-colonies/js-logger';
import type { ITaskResponse } from '@map-colonies/mc-priority-queue';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '@common/constants';
import type { ITaskStrategy } from './taskStrategy';

/**
 * Strategy for handling tiles-deletion tasks.
 * Deletes map tiles before updating to lower resolution.
 */
@injectable()
export class TilesDeletionStrategy implements ITaskStrategy<unknown> {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  /**
   * Executes the tiles deletion task.
   * @param task - The task containing deletion parameters
   */
  public async execute(task: ITaskResponse<unknown>): Promise<void> {
    this.logger.info({
      msg: 'Executing tiles deletion strategy',
      taskId: task.id,
      jobId: task.jobId,
      parameters: task.parameters,
    });

    // TODO: Implement actual tiles deletion logic
    // 1. Parse and validate tile coordinates/paths from task.parameters
    // 2. Connect to tile storage
    // 3. Delete tiles
    // 4. Verify deletion

    this.logger.info({
      msg: 'Tiles deletion completed',
      taskId: task.id,
      jobId: task.jobId,
    });
  }
}
```

### File: `src/cleaner/strategies/index.ts`

```typescript
import type { DependencyContainer } from 'tsyringe';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES, STRATEGY_TOKENS } from '@common/constants';
import { StrategyNotFoundError } from '../errors';
import type { ITaskStrategy } from './taskStrategy';
import { TilesDeletionStrategy } from './tilesDeletionStrategy';

/**
 * Maps task types to their strategy tokens.
 * Add new mappings here when adding new strategies.
 */
const TASK_TYPE_TO_STRATEGY: Record<string, symbol> = {
  'tiles-deletion': STRATEGY_TOKENS.TILES_DELETION,
};

/**
 * Factory for resolving task strategies by task type.
 */
@injectable()
export class StrategyFactory {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject('container') private readonly container: DependencyContainer
  ) {}

  /**
   * Gets the strategy for a given task type.
   * @param taskType - The type of task
   * @returns The strategy instance
   * @throws {StrategyNotFoundError} if no strategy is registered for the task type
   */
  public getStrategy(taskType: string): ITaskStrategy {
    const strategyToken = TASK_TYPE_TO_STRATEGY[taskType];

    if (!strategyToken) {
      this.logger.error({ msg: 'No strategy found for task type', taskType });
      throw new StrategyNotFoundError(taskType);
    }

    return this.container.resolve<ITaskStrategy>(strategyToken);
  }

  /**
   * Checks if a strategy exists for the given task type.
   */
  public hasStrategy(taskType: string): boolean {
    return taskType in TASK_TYPE_TO_STRATEGY;
  }

  /**
   * Gets all registered task types.
   */
  public getRegisteredTaskTypes(): string[] {
    return Object.keys(TASK_TYPE_TO_STRATEGY);
  }
}

export { ITaskStrategy } from './taskStrategy';
export { TilesDeletionStrategy } from './tilesDeletionStrategy';
```

### Test File: `tests/tilesDeletionStrategy.spec.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ITaskResponse } from '@map-colonies/mc-priority-queue';
import { TilesDeletionStrategy } from '@src/cleaner/strategies/tilesDeletionStrategy';

describe('TilesDeletionStrategy', () => {
  let strategy: TilesDeletionStrategy;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    strategy = new TilesDeletionStrategy(mockLogger as never);
  });

  describe('execute', () => {
    it('should log start and completion of task', async () => {
      const task: ITaskResponse<unknown> = {
        id: 'task-123',
        jobId: 'job-456',
        parameters: { path: '/tiles/layer1' },
        type: 'tiles-deletion',
        description: 'Delete tiles',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        status: 'In-Progress',
        attempts: 0,
        reason: '',
        resettable: true,
      };

      await strategy.execute(task);

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Executing tiles deletion strategy',
          taskId: 'task-123',
          jobId: 'job-456',
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Tiles deletion completed',
          taskId: 'task-123',
          jobId: 'job-456',
        })
      );
    });

    it('should complete without throwing for valid task', async () => {
      const task: ITaskResponse<unknown> = {
        id: 'task-123',
        jobId: 'job-456',
        parameters: {},
        type: 'tiles-deletion',
        description: 'Delete tiles',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        status: 'In-Progress',
        attempts: 0,
        reason: '',
        resettable: true,
      };

      await expect(strategy.execute(task)).resolves.toBeUndefined();
    });
  });
});
```

### Test File: `tests/strategyFactory.spec.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DependencyContainer } from 'tsyringe';
import { STRATEGY_TOKENS } from '@src/common/constants';
import { StrategyFactory } from '@src/cleaner/strategies';
import { StrategyNotFoundError } from '@src/cleaner/errors';
import { TilesDeletionStrategy } from '@src/cleaner/strategies/tilesDeletionStrategy';

describe('StrategyFactory', () => {
  let factory: StrategyFactory;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let mockContainer: {
    resolve: ReturnType<typeof vi.fn>;
  };
  let mockStrategy: TilesDeletionStrategy;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    mockStrategy = new TilesDeletionStrategy(mockLogger as never);

    mockContainer = {
      resolve: vi.fn().mockReturnValue(mockStrategy),
    };

    factory = new StrategyFactory(mockLogger as never, mockContainer as unknown as DependencyContainer);
  });

  describe('getStrategy', () => {
    it('should return strategy for tiles-deletion task type', () => {
      const strategy = factory.getStrategy('tiles-deletion');

      expect(strategy).toBe(mockStrategy);
      expect(mockContainer.resolve).toHaveBeenCalledWith(STRATEGY_TOKENS.TILES_DELETION);
    });

    it('should throw StrategyNotFoundError for unknown task type', () => {
      expect(() => factory.getStrategy('unknown-task')).toThrow(StrategyNotFoundError);
      expect(() => factory.getStrategy('unknown-task')).toThrow('No strategy found for task type: unknown-task');
    });

    it('should log error when strategy not found', () => {
      try {
        factory.getStrategy('unknown-task');
      } catch {
        // Expected to throw
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'No strategy found for task type',
          taskType: 'unknown-task',
        })
      );
    });
  });

  describe('hasStrategy', () => {
    it('should return true for tiles-deletion', () => {
      expect(factory.hasStrategy('tiles-deletion')).toBe(true);
    });

    it('should return false for unknown task type', () => {
      expect(factory.hasStrategy('unknown-task')).toBe(false);
    });
  });

  describe('getRegisteredTaskTypes', () => {
    it('should return array containing tiles-deletion', () => {
      const taskTypes = factory.getRegisteredTaskTypes();

      expect(taskTypes).toContain('tiles-deletion');
    });
  });
});
```

---

## Step 8: Create Error Handler

### File: `src/cleaner/errors/errorHandler.ts`

```typescript
import type { Logger } from '@map-colonies/js-logger';
import type { Registry, Counter } from 'prom-client';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '@common/constants';
import type { ErrorContext, ErrorDecision } from '../types';
import { isRecoverableError, isUnrecoverableError } from './errors';

@injectable()
export class ErrorHandler {
  private taskFailuresCounter?: Counter<'job_type' | 'task_type' | 'recoverable'>;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.METRICS) private readonly metricsRegistry: Registry
  ) {
    this.initializeMetrics();
  }

  /**
   * Handles an error and returns a decision on how to proceed.
   */
  public handle(error: unknown, context: ErrorContext): ErrorDecision {
    const isRecoverable = this.determineRecoverability(error, context);
    const reason = this.formatReason(error);

    const decision: ErrorDecision = {
      isRecoverable,
      reason,
      shouldLog: true,
      logLevel: isRecoverable ? 'warn' : 'error',
    };

    this.logError(error, context, decision);
    this.recordMetrics(context, isRecoverable);

    return decision;
  }

  /**
   * Determines if an error is recoverable.
   */
  private determineRecoverability(error: unknown, context: ErrorContext): boolean {
    // If it's explicitly marked, use that
    if (isRecoverableError(error)) {
      // But only if we haven't exceeded max attempts
      return context.attempts < context.maxAttempts;
    }

    if (isUnrecoverableError(error)) {
      return false;
    }

    // For unknown errors, treat as recoverable if under max attempts
    return context.attempts < context.maxAttempts;
  }

  /**
   * Formats an error into a reason string.
   */
  private formatReason(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Logs the error with appropriate context.
   */
  private logError(error: unknown, context: ErrorContext, decision: ErrorDecision): void {
    const logData = {
      msg: 'Task processing failed',
      taskId: context.taskId,
      jobId: context.jobId,
      jobType: context.jobType,
      taskType: context.taskType,
      attempts: context.attempts,
      maxAttempts: context.maxAttempts,
      isRecoverable: decision.isRecoverable,
      error: error instanceof Error ? { message: error.message, name: error.name, stack: error.stack } : error,
    };

    if (decision.logLevel === 'error') {
      this.logger.error(logData);
    } else {
      this.logger.warn(logData);
    }
  }

  /**
   * Records failure metrics.
   */
  private recordMetrics(context: ErrorContext, isRecoverable: boolean): void {
    this.taskFailuresCounter?.inc({
      job_type: context.jobType,
      task_type: context.taskType,
      recoverable: String(isRecoverable),
    });
  }

  /**
   * Initializes Prometheus metrics.
   */
  private initializeMetrics(): void {
    try {
      this.taskFailuresCounter = new (require('prom-client').Counter)({
        name: 'cleaner_task_failures_total',
        help: 'Total number of task failures',
        labelNames: ['job_type', 'task_type', 'recoverable'],
        registers: [this.metricsRegistry],
      });
    } catch {
      // Metrics may already be registered in tests
    }
  }
}

export { ErrorHandler };
```

### Update: `src/cleaner/errors/index.ts`

Replace with:

```typescript
export { RecoverableError, UnrecoverableError, ValidationError, StrategyNotFoundError, isRecoverableError, isUnrecoverableError } from './errors';
export { ErrorHandler } from './errorHandler';
```

### Test File: `tests/errorHandler.spec.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Registry } from 'prom-client';
import { ErrorHandler } from '@src/cleaner/errors/errorHandler';
import { RecoverableError, UnrecoverableError, ValidationError } from '@src/cleaner/errors';
import type { ErrorContext } from '@src/cleaner/types';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let metricsRegistry: Registry;

  const createContext = (overrides: Partial<ErrorContext> = {}): ErrorContext => ({
    jobType: 'Ingestion_Update',
    taskType: 'tiles-deletion',
    taskId: 'task-123',
    jobId: 'job-456',
    attempts: 1,
    maxAttempts: 3,
    ...overrides,
  });

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    metricsRegistry = new Registry();
    errorHandler = new ErrorHandler(mockLogger as never, metricsRegistry);
  });

  describe('handle', () => {
    describe('RecoverableError', () => {
      it('should return recoverable decision when attempts < maxAttempts', () => {
        const error = new RecoverableError('Transient failure');
        const context = createContext({ attempts: 1, maxAttempts: 3 });

        const decision = errorHandler.handle(error, context);

        expect(decision.isRecoverable).toBe(true);
        expect(decision.reason).toBe('Transient failure');
        expect(decision.logLevel).toBe('warn');
      });

      it('should return unrecoverable decision when attempts >= maxAttempts', () => {
        const error = new RecoverableError('Transient failure');
        const context = createContext({ attempts: 3, maxAttempts: 3 });

        const decision = errorHandler.handle(error, context);

        expect(decision.isRecoverable).toBe(false);
      });
    });

    describe('UnrecoverableError', () => {
      it('should always return unrecoverable decision', () => {
        const error = new UnrecoverableError('Fatal failure');
        const context = createContext({ attempts: 1, maxAttempts: 3 });

        const decision = errorHandler.handle(error, context);

        expect(decision.isRecoverable).toBe(false);
        expect(decision.reason).toBe('Fatal failure');
        expect(decision.logLevel).toBe('error');
      });
    });

    describe('ValidationError', () => {
      it('should return unrecoverable decision', () => {
        const error = new ValidationError('Invalid parameters');
        const context = createContext();

        const decision = errorHandler.handle(error, context);

        expect(decision.isRecoverable).toBe(false);
        expect(decision.reason).toBe('Invalid parameters');
      });
    });

    describe('Regular Error', () => {
      it('should return recoverable when under max attempts', () => {
        const error = new Error('Unknown error');
        const context = createContext({ attempts: 1, maxAttempts: 3 });

        const decision = errorHandler.handle(error, context);

        expect(decision.isRecoverable).toBe(true);
      });

      it('should return unrecoverable when at max attempts', () => {
        const error = new Error('Unknown error');
        const context = createContext({ attempts: 3, maxAttempts: 3 });

        const decision = errorHandler.handle(error, context);

        expect(decision.isRecoverable).toBe(false);
      });
    });

    describe('Logging', () => {
      it('should log warning for recoverable errors', () => {
        const error = new RecoverableError('Transient');
        const context = createContext();

        errorHandler.handle(error, context);

        expect(mockLogger.warn).toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should log error for unrecoverable errors', () => {
        const error = new UnrecoverableError('Fatal');
        const context = createContext();

        errorHandler.handle(error, context);

        expect(mockLogger.error).toHaveBeenCalled();
        expect(mockLogger.warn).not.toHaveBeenCalled();
      });

      it('should include context in log', () => {
        const error = new Error('Test');
        const context = createContext();

        errorHandler.handle(error, context);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: context.taskId,
            jobId: context.jobId,
            jobType: context.jobType,
            taskType: context.taskType,
            attempts: context.attempts,
            maxAttempts: context.maxAttempts,
          })
        );
      });
    });

    describe('Non-Error values', () => {
      it('should handle string errors', () => {
        const context = createContext();

        const decision = errorHandler.handle('String error', context);

        expect(decision.reason).toBe('String error');
      });

      it('should handle null errors', () => {
        const context = createContext();

        const decision = errorHandler.handle(null, context);

        expect(decision.reason).toBe('null');
      });
    });
  });
});
```

---

## Step 9: Create TaskPoller

### File: `src/cleaner/taskPoller.ts`

```typescript
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import type { Logger } from '@map-colonies/js-logger';
import type { TaskHandler as QueueClient, ITaskResponse } from '@map-colonies/mc-priority-queue';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import type { PollingConfig, PollingPairConfig, ErrorContext } from './types';
import { TaskValidator } from './validation';
import { StrategyFactory } from './strategies';
import { ErrorHandler, ValidationError } from './errors';

@injectable()
export class TaskPoller {
  private isRunning = false;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.QUEUE_CLIENT) private readonly queueClient: QueueClient,
    private readonly taskValidator: TaskValidator,
    private readonly strategyFactory: StrategyFactory,
    private readonly errorHandler: ErrorHandler
  ) {}

  /**
   * Starts the polling loop.
   * Polls all configured job/task pairs in round-robin fashion.
   */
  public async start(): Promise<void> {
    const pollingConfig = this.config.get<PollingConfig>('polling');
    const { pairs, dequeueIntervalMs } = pollingConfig;

    this.logger.info({
      msg: 'Starting task poller',
      pairs: pairs.map((p) => `${p.jobType}:${p.taskType}`),
      dequeueIntervalMs,
    });

    this.isRunning = true;

    while (this.isRunning) {
      await this.pollAllPairs(pairs, dequeueIntervalMs);
    }

    this.logger.info({ msg: 'Task poller stopped' });
  }

  /**
   * Stops the polling loop gracefully.
   */
  public stop(): void {
    this.logger.info({ msg: 'Stopping task poller' });
    this.isRunning = false;
  }

  /**
   * Returns whether the poller is currently running.
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Polls all configured pairs in round-robin fashion.
   */
  private async pollAllPairs(pairs: PollingPairConfig[], dequeueIntervalMs: number): Promise<void> {
    let taskProcessed = false;

    for (const pair of pairs) {
      if (!this.isRunning) {
        break;
      }

      const processed = await this.pollPair(pair);
      if (processed) {
        taskProcessed = true;
      }
    }

    // If no task was processed in this round, wait before next round
    if (!taskProcessed) {
      await setTimeoutPromise(dequeueIntervalMs);
    }
  }

  /**
   * Polls a single job/task pair.
   * @returns true if a task was processed, false otherwise
   */
  private async pollPair(pair: PollingPairConfig): Promise<boolean> {
    const { jobType, taskType, maxAttempts } = pair;

    try {
      const task = await this.queueClient.dequeue<unknown>(jobType, taskType);

      if (!task) {
        return false;
      }

      await this.processTask(task, pair);
      return true;
    } catch (error) {
      // Log polling errors but don't crash the loop
      this.logger.error({
        msg: 'Error polling for tasks',
        jobType,
        taskType,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Processes a single task.
   */
  private async processTask(task: ITaskResponse<unknown>, pair: PollingPairConfig): Promise<void> {
    const { jobType, taskType, maxAttempts } = pair;
    const { id: taskId, jobId, attempts } = task;

    this.logger.info({
      msg: 'Processing task',
      taskId,
      jobId,
      jobType,
      taskType,
      attempts,
    });

    try {
      // Validate task parameters
      const validatedParams = this.taskValidator.validate(taskType, task.parameters);

      // Get and execute strategy
      const strategy = this.strategyFactory.getStrategy(taskType);
      await strategy.execute({ ...task, parameters: validatedParams });

      // Acknowledge successful completion
      await this.queueClient.ack(jobId, taskId);

      this.logger.info({
        msg: 'Task completed successfully',
        taskId,
        jobId,
        jobType,
        taskType,
      });
    } catch (error) {
      await this.handleTaskError(error, task, pair);
    }
  }

  /**
   * Handles task processing errors.
   */
  private async handleTaskError(error: unknown, task: ITaskResponse<unknown>, pair: PollingPairConfig): Promise<void> {
    const { jobType, taskType, maxAttempts } = pair;
    const { id: taskId, jobId, attempts } = task;

    const context: ErrorContext = {
      jobType,
      taskType,
      taskId,
      jobId,
      attempts,
      maxAttempts,
    };

    const decision = this.errorHandler.handle(error, context);

    await this.queueClient.reject(jobId, taskId, decision.isRecoverable, decision.reason);
  }
}
```

### Test File: `tests/taskPoller.spec.ts`

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { TaskHandler as QueueClient, ITaskResponse } from '@map-colonies/mc-priority-queue';
import { TaskPoller } from '@src/cleaner/taskPoller';
import { TaskValidator } from '@src/cleaner/validation';
import { StrategyFactory, type ITaskStrategy } from '@src/cleaner/strategies';
import { ErrorHandler, ValidationError, StrategyNotFoundError } from '@src/cleaner/errors';
import type { PollingConfig } from '@src/cleaner/types';

describe('TaskPoller', () => {
  let taskPoller: TaskPoller;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    get: ReturnType<typeof vi.fn>;
  };
  let mockQueueClient: {
    dequeue: ReturnType<typeof vi.fn>;
    ack: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
  };
  let mockTaskValidator: {
    validate: ReturnType<typeof vi.fn>;
  };
  let mockStrategyFactory: {
    getStrategy: ReturnType<typeof vi.fn>;
  };
  let mockErrorHandler: {
    handle: ReturnType<typeof vi.fn>;
  };
  let mockStrategy: {
    execute: ReturnType<typeof vi.fn>;
  };

  const pollingConfig: PollingConfig = {
    dequeueIntervalMs: 100,
    pairs: [{ jobType: 'Ingestion_Update', taskType: 'tiles-deletion', maxAttempts: 3 }],
  };

  const createMockTask = (overrides: Partial<ITaskResponse<unknown>> = {}): ITaskResponse<unknown> => ({
    id: 'task-123',
    jobId: 'job-456',
    parameters: { path: '/tiles' },
    type: 'tiles-deletion',
    description: 'Delete tiles',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    status: 'In-Progress',
    attempts: 1,
    reason: '',
    resettable: true,
    ...overrides,
  });

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    mockConfig = {
      get: vi.fn().mockReturnValue(pollingConfig),
    };

    mockQueueClient = {
      dequeue: vi.fn(),
      ack: vi.fn(),
      reject: vi.fn(),
    };

    mockTaskValidator = {
      validate: vi.fn().mockImplementation((_, params) => params),
    };

    mockStrategy = {
      execute: vi.fn().mockResolvedValue(undefined),
    };

    mockStrategyFactory = {
      getStrategy: vi.fn().mockReturnValue(mockStrategy),
    };

    mockErrorHandler = {
      handle: vi.fn().mockReturnValue({
        isRecoverable: true,
        reason: 'Error message',
        shouldLog: true,
        logLevel: 'warn',
      }),
    };

    taskPoller = new TaskPoller(
      mockLogger as never,
      mockConfig as never,
      mockQueueClient as unknown as QueueClient,
      mockTaskValidator as unknown as TaskValidator,
      mockStrategyFactory as unknown as StrategyFactory,
      mockErrorHandler as unknown as ErrorHandler
    );
  });

  afterEach(() => {
    taskPoller.stop();
  });

  describe('start', () => {
    it('should log start message with configured pairs', async () => {
      mockQueueClient.dequeue.mockResolvedValue(null);

      const startPromise = taskPoller.start();
      // Let one iteration run
      await vi.waitFor(() => expect(mockQueueClient.dequeue).toHaveBeenCalled());
      taskPoller.stop();
      await startPromise;

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Starting task poller',
          pairs: ['Ingestion_Update:tiles-deletion'],
        })
      );
    });

    it('should poll configured pairs', async () => {
      mockQueueClient.dequeue.mockResolvedValue(null);

      const startPromise = taskPoller.start();
      await vi.waitFor(() => expect(mockQueueClient.dequeue).toHaveBeenCalled());
      taskPoller.stop();
      await startPromise;

      expect(mockQueueClient.dequeue).toHaveBeenCalledWith('Ingestion_Update', 'tiles-deletion');
    });
  });

  describe('stop', () => {
    it('should stop the polling loop', async () => {
      mockQueueClient.dequeue.mockResolvedValue(null);

      const startPromise = taskPoller.start();
      await vi.waitFor(() => expect(taskPoller.getIsRunning()).toBe(true));

      taskPoller.stop();
      await startPromise;

      expect(taskPoller.getIsRunning()).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'Task poller stopped' }));
    });
  });

  describe('task processing', () => {
    it('should process task successfully', async () => {
      const task = createMockTask();
      mockQueueClient.dequeue.mockResolvedValueOnce(task).mockResolvedValue(null);

      const startPromise = taskPoller.start();
      await vi.waitFor(() => expect(mockQueueClient.ack).toHaveBeenCalled());
      taskPoller.stop();
      await startPromise;

      expect(mockTaskValidator.validate).toHaveBeenCalledWith('tiles-deletion', task.parameters);
      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith('tiles-deletion');
      expect(mockStrategy.execute).toHaveBeenCalled();
      expect(mockQueueClient.ack).toHaveBeenCalledWith('job-456', 'task-123');
    });

    it('should reject task on validation error', async () => {
      const task = createMockTask();
      mockQueueClient.dequeue.mockResolvedValueOnce(task).mockResolvedValue(null);
      mockTaskValidator.validate.mockImplementation(() => {
        throw new ValidationError('Invalid params');
      });
      mockErrorHandler.handle.mockReturnValue({
        isRecoverable: false,
        reason: 'Invalid params',
        shouldLog: true,
        logLevel: 'error',
      });

      const startPromise = taskPoller.start();
      await vi.waitFor(() => expect(mockQueueClient.reject).toHaveBeenCalled());
      taskPoller.stop();
      await startPromise;

      expect(mockQueueClient.reject).toHaveBeenCalledWith('job-456', 'task-123', false, 'Invalid params');
    });

    it('should reject task on strategy error', async () => {
      const task = createMockTask();
      mockQueueClient.dequeue.mockResolvedValueOnce(task).mockResolvedValue(null);
      mockStrategy.execute.mockRejectedValue(new Error('Strategy failed'));

      const startPromise = taskPoller.start();
      await vi.waitFor(() => expect(mockQueueClient.reject).toHaveBeenCalled());
      taskPoller.stop();
      await startPromise;

      expect(mockErrorHandler.handle).toHaveBeenCalled();
      expect(mockQueueClient.reject).toHaveBeenCalled();
    });

    it('should reject task on strategy not found', async () => {
      const task = createMockTask();
      mockQueueClient.dequeue.mockResolvedValueOnce(task).mockResolvedValue(null);
      mockStrategyFactory.getStrategy.mockImplementation(() => {
        throw new StrategyNotFoundError('unknown');
      });

      const startPromise = taskPoller.start();
      await vi.waitFor(() => expect(mockQueueClient.reject).toHaveBeenCalled());
      taskPoller.stop();
      await startPromise;

      expect(mockErrorHandler.handle).toHaveBeenCalled();
    });
  });

  describe('getIsRunning', () => {
    it('should return false initially', () => {
      expect(taskPoller.getIsRunning()).toBe(false);
    });

    it('should return true when running', async () => {
      mockQueueClient.dequeue.mockResolvedValue(null);

      const startPromise = taskPoller.start();
      await vi.waitFor(() => expect(taskPoller.getIsRunning()).toBe(true));

      taskPoller.stop();
      await startPromise;
    });
  });
});
```

---

## Step 10: Update containerConfig.ts

### File: `src/containerConfig.ts`

Replace the entire file with:

```typescript
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { Registry } from 'prom-client';
import { container, instancePerContainerCachingFactory } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { type Logger } from '@map-colonies/js-logger';
import { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { InjectionObject, registerDependencies } from '@common/dependencyRegistration';
import { SERVICES, SERVICE_NAME, STRATEGY_TOKENS } from '@common/constants';
import { getTracing } from '@common/tracing';
import { type ConfigType, getConfig } from './common/config';
import type { QueueConfig, HttpRetryConfig } from './cleaner/types';
import { TaskPoller } from './cleaner/taskPoller';
import { TaskValidator } from './cleaner/validation';
import { StrategyFactory, TilesDeletionStrategy } from './cleaner/strategies';
import { ErrorHandler } from './cleaner/errors';

// =============================================================================
// TODO: When we move to the new job-manager, we will use @map-colonies/jobnik-sdk
// The imports below are commented out until the migration is complete.
// =============================================================================
// import { IWorker, JobnikSDK } from '@map-colonies/jobnik-sdk';
// import { workerBuilder } from './worker';
// import { LogisticJobTypes, LogisticStageTypes } from './logistics/types';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const configInstance = getConfig();

  const loggerConfig = configInstance.get('telemetry.logger');

  const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });

  const tracer = trace.getTracer(SERVICE_NAME);
  const metricsRegistry = new Registry();
  configInstance.initializeMetrics(metricsRegistry);

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: configInstance } },
    { token: SERVICES.LOGGER, provider: { useValue: logger } },
    { token: SERVICES.TRACER, provider: { useValue: tracer } },
    { token: SERVICES.METRICS, provider: { useValue: metricsRegistry } },

    // Queue Client (mc-priority-queue)
    {
      token: SERVICES.QUEUE_CLIENT,
      provider: {
        useFactory: instancePerContainerCachingFactory((depContainer) => {
          const containerLogger = depContainer.resolve<Logger>(SERVICES.LOGGER);
          const config = depContainer.resolve<ConfigType>(SERVICES.CONFIG);
          const queueConfig = config.get<QueueConfig>('queue');
          const httpRetryConfig = config.get<HttpRetryConfig>('httpRetry');

          return new QueueClient(
            containerLogger,
            queueConfig.jobManagerBaseUrl,
            queueConfig.heartbeatBaseUrl,
            config.get<number>('polling.dequeueIntervalMs'),
            queueConfig.heartbeatIntervalMs,
            httpRetryConfig
          );
        }),
      },
    },

    // Container reference for strategy factory
    { token: 'container', provider: { useValue: container } },

    // Strategies
    { token: STRATEGY_TOKENS.TILES_DELETION, provider: { useClass: TilesDeletionStrategy } },

    // Services
    { token: SERVICES.TASK_VALIDATOR, provider: { useClass: TaskValidator } },
    { token: SERVICES.STRATEGY_FACTORY, provider: { useClass: StrategyFactory } },
    { token: SERVICES.ERROR_HANDLER, provider: { useClass: ErrorHandler } },
    { token: SERVICES.TASK_POLLER, provider: { useClass: TaskPoller } },

    // Graceful shutdown
    {
      token: 'onSignal',
      provider: {
        useFactory: (depContainer) => {
          const taskPoller = depContainer.resolve<TaskPoller>(SERVICES.TASK_POLLER);
          return async (): Promise<void> => {
            taskPoller.stop();
            await getTracing().stop();
          };
        },
      },
    },

    // =============================================================================
    // TODO: When we move to the new job-manager, we will use @map-colonies/jobnik-sdk
    // The registrations below are commented out until the migration is complete.
    // =============================================================================
    /*
    {
      token: SERVICES.JOBNIK_SDK,
      provider: {
        useFactory: instancePerContainerCachingFactory((depContainer) => {
          const containerLogger = depContainer.resolve<Logger>(SERVICES.LOGGER);
          const config = depContainer.resolve<ConfigType>(SERVICES.CONFIG);
          const containerMetricsRegistry = depContainer.resolve<Registry>(SERVICES.METRICS);
          return new JobnikSDK<LogisticJobTypes, LogisticStageTypes>({
            ...config.get('jobnik.sdk'),
            logger: containerLogger,
            metricsRegistry: containerMetricsRegistry,
          });
        }),
      },
    },
    {
      token: SERVICES.WORKER,
      provider: {
        useFactory: instancePerContainerCachingFactory(workerBuilder),
      },
    },
    */
  ];

  return Promise.resolve(registerDependencies(dependencies, options?.override, options?.useChild));
};
```

---

## Step 11: Update index.ts

### File: `src/index.ts`

Replace the entire file with:

```typescript
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { createServer } from 'node:http';
import express from 'express';
import { metricsMiddleware } from '@map-colonies/telemetry/prom-metrics';
import { createTerminus } from '@godaddy/terminus';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import { registerExternalValues } from './containerConfig';
import { TaskPoller } from './cleaner/taskPoller';

// =============================================================================
// TODO: When we move to the new job-manager, we will use @map-colonies/jobnik-sdk
// The imports below are commented out until the migration is complete.
// =============================================================================
// import type { IWorker } from '@map-colonies/jobnik-sdk';
// import { LogisticsSDK } from './logistics/types';
// import { seedData } from './seeder';

void registerExternalValues()
  .then(async (container) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    const config = container.resolve<ConfigType>(SERVICES.CONFIG);
    const taskPoller = container.resolve<TaskPoller>(SERVICES.TASK_POLLER);

    // =============================================================================
    // TODO: When we move to the new job-manager, we will use @map-colonies/jobnik-sdk
    // The code below is commented out until the migration is complete.
    // =============================================================================
    // const worker = container.resolve<IWorker>(SERVICES.WORKER);
    // const sdk = container.resolve<LogisticsSDK>(SERVICES.JOBNIK_SDK);
    // await seedData(sdk.getProducer());

    const port = config.get('server.port');
    const stubHealthCheck = async (): Promise<void> => Promise.resolve();

    const app = express();

    app.use(metricsMiddleware(container.resolve(SERVICES.METRICS), true));
    const server = createTerminus(createServer(app), {
      healthChecks: { '/liveness': stubHealthCheck },
      onSignal: container.resolve('onSignal'),
    });
    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
    });

    // Start the task poller (replaces worker.start() from jobnik-sdk)
    await taskPoller.start();

    // =============================================================================
    // TODO: When we move to the new job-manager, replace taskPoller.start() with:
    // await worker.start();
    // =============================================================================
  })
  .catch((error: Error) => {
    console.error('failed initializing the worker');
    console.error(error);
    process.exit(1);
  });
```

---

## Step 12: Comment out worker.ts

### File: `src/worker.ts`

Replace the entire file with:

```typescript
// =============================================================================
// TODO: When we move to the new job-manager, we will use @map-colonies/jobnik-sdk
// The code below is commented out until the migration is complete.
// Uncomment and update when migrating to the new job-manager.
// =============================================================================

/*
import type { IWorker } from '@map-colonies/jobnik-sdk';
import type { Logger } from '@map-colonies/js-logger';
import type { DependencyContainer, FactoryFunction } from 'tsyringe';
import { SERVICES } from './common/constants';
import { LogisticsManager } from './logistics/manager';
import { LogisticsSDK } from './logistics/types';
import { ConfigType } from './common/config';

export const workerBuilder: FactoryFunction<IWorker> = (container: DependencyContainer) => {
  const sdk = container.resolve<LogisticsSDK>(SERVICES.JOBNIK_SDK);
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);

  const logisticsManager = container.resolve(LogisticsManager);

  const worker = sdk.createWorker<'hazmatTransport', 'delivery'>(
    'delivery',
    logisticsManager.handleDeliveryTask.bind(logisticsManager),
    config.get('jobnik.worker')
  );

  worker.on('error', (err) => {
    logger.error({ msg: 'Worker encountered an error:', err });
  });

  return worker;
};
*/

export {};
```

---

## Step 13: Delete Old Files

Delete the following files and directories:

```bash
rm -rf src/logistics
rm -f src/seeder.ts
rm -f tests/logistics.spec.ts
```

---

## Step 14: Update Test Helpers

### File: `tests/helpers/fakes.ts`

Replace the entire file with:

```typescript
import { simpleFaker } from '@faker-js/faker';
import type { ITaskResponse } from '@map-colonies/mc-priority-queue';
import { vitest } from 'vitest';
import jsLogger from '@map-colonies/js-logger';

/**
 * Creates a mock task response for testing.
 */
export function createMockTaskResponse<T = unknown>(overrides: Partial<ITaskResponse<T>> = {}): ITaskResponse<T> {
  return {
    id: simpleFaker.string.uuid(),
    jobId: simpleFaker.string.uuid(),
    type: 'tiles-deletion',
    description: 'Test task',
    parameters: {} as T,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    status: 'In-Progress',
    attempts: 0,
    reason: '',
    resettable: true,
    ...overrides,
  };
}

/**
 * Creates a mock logger for testing.
 */
export function createMockLogger() {
  return {
    info: vitest.fn(),
    error: vitest.fn(),
    warn: vitest.fn(),
    debug: vitest.fn(),
    trace: vitest.fn(),
    fatal: vitest.fn(),
  };
}

/**
 * Creates a mock queue client for testing.
 */
export function createMockQueueClient() {
  return {
    dequeue: vitest.fn(),
    ack: vitest.fn(),
    reject: vitest.fn(),
    updateProgress: vitest.fn(),
  };
}

/**
 * Creates a disabled logger for testing.
 */
export function createDisabledLogger() {
  return jsLogger({ enabled: false });
}
```

---

## Step 15: Create Directory Structure

Ensure the following directory structure exists:

```
src/
  cleaner/
    errors/
      errors.ts
      errorHandler.ts
      index.ts
    strategies/
      index.ts
      taskStrategy.ts
      tilesDeletionStrategy.ts
    validation/
      index.ts
      schemas.ts
    taskPoller.ts
    types.ts
```

Create directories:

```bash
mkdir -p src/cleaner/errors
mkdir -p src/cleaner/strategies
mkdir -p src/cleaner/validation
```

---

## Verification Steps

After implementing all steps, run these commands to verify:

### 1. Install dependencies

```bash
npm install --legacy-peer-deps
```

### 2. Run linting

```bash
npm run lint
```

If there are lint errors, run:

```bash
npm run lint:fix
```

### 3. Run tests

```bash
npm test
```

All tests should pass with 80%+ coverage.

### 4. Run build

```bash
npm run build
```

Build should complete without errors.

### 5. Verify file structure

```bash
find src/cleaner -type f -name "*.ts" | sort
```

Expected output:

```
src/cleaner/errors/errorHandler.ts
src/cleaner/errors/errors.ts
src/cleaner/errors/index.ts
src/cleaner/strategies/index.ts
src/cleaner/strategies/taskStrategy.ts
src/cleaner/strategies/tilesDeletionStrategy.ts
src/cleaner/taskPoller.ts
src/cleaner/types.ts
src/cleaner/validation/index.ts
src/cleaner/validation/schemas.ts
```

---

## Summary

This implementation provides:

1. **TaskPoller** - Round-robin polling of configured job/task pairs
2. **TaskValidator** - Zod-based validation with registry pattern
3. **StrategyFactory** - tsyringe-based strategy resolution
4. **TilesDeletionStrategy** - Skeleton strategy for tiles deletion
5. **ErrorHandler** - Centralized error handling with metrics
6. **Custom Errors** - RecoverableError, UnrecoverableError, ValidationError
7. **Full test coverage** - Unit tests for all components

The jobnik-sdk code is preserved in comments for future migration.
