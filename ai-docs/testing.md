# Testing

## Overview

The project uses [Vitest](https://vitest.dev/) with V8 coverage for testing. We follow a **hybrid testing approach** combining unit and integration tests.

## Commands

| Command                                      | Description                 |
| -------------------------------------------- | --------------------------- |
| `npm test`                                   | Run all tests with coverage |
| `npm run test:watch`                         | Watch mode for development  |
| `npm run test:ui`                            | Open Vitest UI dashboard    |
| `npx vitest run tests/file.spec.ts`          | Run specific test file      |
| `npx vitest run -t "test name"`              | Run tests matching pattern  |
| `npx vitest run tests/*.spec.ts`             | Run only unit tests         |
| `npx vitest run tests/*.integration.spec.ts` | Run only integration tests  |

## Testing Philosophy

We use a **hybrid approach**:

- **Unit tests** (`*.spec.ts`) — Test individual classes/functions in isolation with mocked dependencies
- **Integration tests** (`*.integration.spec.ts`) — Test component interactions with real dependencies

### When to Use Unit Tests

- Testing business logic (error handling, validation, decision logic)
- Fast feedback during development
- Testing edge cases and error paths
- When dependencies are complex or slow (HTTP clients, file I/O)

### When to Use Integration Tests

- Testing component wiring and dependency injection
- Verifying end-to-end workflows (polling → validation → strategy → ack/reject)
- Testing configuration loading and service initialization
- When interactions between real components are critical

## File Structure

```
tests/
  errorHandler.spec.ts           # Unit test
  validation.spec.ts             # Unit test
  taskPoller.integration.spec.ts # Integration test
  helpers/
    mocks.ts                     # Reusable mock factories
    fakes.ts                     # Fake data generators
  setup/
    vite.setup.ts                # Vitest global setup
```

## Writing Unit Tests

### Basic Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorHandler } from '../src/cleaner/errors';
import { createMockLogger } from './helpers/mocks';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    errorHandler = new ErrorHandler(mockLogger);
  });

  it('should retry recoverable errors when attempts remain', () => {
    const error = new RecoverableError('Network timeout');
    const context = { jobId: '123', taskId: '456', attemptNumber: 1, maxAttempts: 3, error };

    const decision = errorHandler.handleError(context);

    expect(decision.shouldRetry).toBe(true);
    expect(decision.reason).toContain('1/3');
  });
});
```

### Using Mock Helpers

Use `createMockLogger()` from `tests/helpers/mocks.ts` for consistent logger mocking:

```typescript
import { createMockLogger } from './helpers/mocks';

const mockLogger = createMockLogger();
// All logger methods are vi.fn() spies: debug, info, warn, error, fatal, trace
expect(mockLogger.error).toHaveBeenCalled();
```

### Generating Test Data with Faker

```typescript
import { faker } from '@faker-js/faker';

const taskId = faker.string.uuid();
const jobId = faker.string.uuid();
const errorMessage = faker.lorem.sentence();
const resourcePath = faker.system.filePath();
const timestamp = faker.date.past().toISOString();

// For complex objects
const mockTask = {
  id: faker.string.uuid(),
  type: faker.helpers.arrayElement(['tiles-deletion', 'cleanup']),
  parameters: {
    layerPath: faker.system.directoryPath(),
    extent: faker.location.latitude(),
  },
};
```

## Writing Integration Tests

### Testing with DI Container

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { SERVICES } from '../src/common/constants';
import { StrategyFactory } from '../src/cleaner/strategies';

describe('StrategyFactory Integration', () => {
  let childContainer: DependencyContainer;

  beforeEach(() => {
    childContainer = container.createChildContainer();
    // Register real or mock dependencies
    childContainer.register(SERVICES.LOGGER, { useValue: createMockLogger() });
  });

  afterEach(() => {
    childContainer.clearInstances();
  });

  it('should resolve registered strategy from container', () => {
    childContainer.register('tiles-deletion', { useClass: TilesDeletionStrategy });
    const factory = new StrategyFactory(childContainer.resolve(SERVICES.LOGGER), childContainer);

    const strategy = factory.resolve('tiles-deletion');

    expect(strategy).toBeInstanceOf(TilesDeletionStrategy);
  });
});
```

## Test Utilities

### Reusable Mocks (`tests/helpers/mocks.ts`)

```typescript
import { vi } from 'vitest';
import type { Logger } from '@map-colonies/js-logger';

export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  } as unknown as Logger;
}
```

### Custom Mock Factories

Create reusable factories in `tests/helpers/mocks.ts`:

```typescript
export function createMockTaskResponse(overrides = {}) {
  return {
    jobId: faker.string.uuid(),
    taskId: faker.string.uuid(),
    ack: vi.fn(),
    reject: vi.fn(),
    ...overrides,
  };
}
```

## Coverage

Coverage reports are generated in three formats:

- **text** — Terminal output during test run
- **html** — Browse at `coverage/index.html`
- **json/json-summary** — For CI integration

### Coverage Thresholds

Configured in `vitest.config.mts` at **80%** for all metrics:

```typescript
coverage: {
  thresholds: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
}
```

Tests will fail if coverage drops below these thresholds.

## Troubleshooting

### Tests Pass Locally But Fail in CI

- Check Node version matches (`>=24.0.0` required)
- Verify environment variables are set correctly
- Clear coverage cache: `rm -rf coverage .vitest`

### Mock Not Being Called

```typescript
// Ensure mock is called with exact arguments
expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({ msg: 'Task failed' }));

// Check if called at all
expect(mockLogger.error).toHaveBeenCalled();

// Verify call count
expect(mockLogger.error).toHaveBeenCalledTimes(1);
```

### Type Errors with Mocks

```typescript
// Use 'as unknown as Type' for complex mocks
const mockLogger = {
  debug: vi.fn(),
  // ... other methods
} as unknown as Logger;
```

### Async Test Timeout

```typescript
// Increase timeout for slow tests (default: 5000ms)
it('should handle long operation', async () => {
  // ...
}, 10000); // 10 second timeout
```

### DI Container State Leaking Between Tests

```typescript
// Always use child containers in tests
beforeEach(() => {
  childContainer = container.createChildContainer();
});

afterEach(() => {
  childContainer.clearInstances();
});
```

## Best Practices

1. **Descriptive test names** — Use `should <behavior> when <condition>` format
2. **Arrange-Act-Assert** — Structure tests clearly: setup, execute, verify
3. **One assertion per test** — Focus each test on a single behavior
4. **Mock external dependencies** — Logger, HTTP clients, file system, queue clients
5. **Use faker for test data** — Avoid hardcoded strings, generate realistic data
6. **Test error paths** — Validate error handling, not just happy paths
7. **Isolate tests** — No shared state, use `beforeEach` for fresh instances
8. **Use helper functions** — Extract common setup into `tests/helpers/`
