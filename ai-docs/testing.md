# Testing

## Framework

The project uses [Vitest](https://vitest.dev/) for testing with V8 coverage.

## Commands

| Command              | Description                 |
| -------------------- | --------------------------- |
| `npm test`           | Run all tests with coverage |
| `npm run test:watch` | Watch mode for development  |
| `npm run test:ui`    | Open Vitest UI dashboard    |

## Configuration

Test configuration is in `vitest.config.mts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
```

## File Structure

```
tests/
  *.spec.ts           # Test files
  helpers/            # Test utilities (if needed)
  mocks/              # Mock implementations (if needed)
```

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CleanerManager } from '../src/cleaner/manager';

describe('CleanerManager', () => {
  let manager: CleanerManager;

  beforeEach(() => {
    manager = new CleanerManager();
  });

  describe('handleCleanupTask', () => {
    it('should process valid cleanup task', async () => {
      const task = createMockTask({ resourcePath: '/tmp/test' });
      const context = createMockContext();

      await manager.handleCleanupTask(task, context);

      expect(context.updateStageUserMetadata).toHaveBeenCalled();
    });

    it('should throw error for invalid resource path', async () => {
      const task = createMockTask({ resourcePath: '' });
      const context = createMockContext();

      await expect(manager.handleCleanupTask(task, context)).rejects.toThrow('Resource path is required');
    });
  });
});
```

### Mocking Dependencies

```typescript
import { vi } from 'vitest';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// Mock task context
const createMockContext = () => ({
  logger: mockLogger,
  job: {
    id: 'job-123',
    userMetadata: { initiatedBy: 'test' },
  },
  updateStageUserMetadata: vi.fn(),
});

// Mock task
const createMockTask = (data: Partial<TaskData> = {}) => ({
  id: 'task-123',
  data: {
    resourcePath: '/default/path',
    expirationDate: new Date().toISOString(),
    ...data,
  },
});
```

### Testing with DI Container

```typescript
import { container } from 'tsyringe';
import { beforeEach, afterEach } from 'vitest';

describe('Integration Tests', () => {
  beforeEach(() => {
    // Create child container for isolation
    const childContainer = container.createChildContainer();

    // Register mocks
    childContainer.register(SERVICES.LOGGER, { useValue: mockLogger });
  });

  afterEach(() => {
    container.clearInstances();
  });
});
```

### Testing Async Operations

```typescript
import { vi } from 'vitest';

it('should handle async cleanup', async () => {
  // Mock async operation
  const cleanupFn = vi.fn().mockResolvedValue(undefined);

  await manager.cleanup(cleanupFn);

  expect(cleanupFn).toHaveBeenCalledTimes(1);
});

it('should handle async errors', async () => {
  const cleanupFn = vi.fn().mockRejectedValue(new Error('Cleanup failed'));

  await expect(manager.cleanup(cleanupFn)).rejects.toThrow('Cleanup failed');
});
```

## Test Utilities

### Using Faker for Test Data

```typescript
import { faker } from '@faker-js/faker';

const createRandomTask = () => ({
  id: faker.string.uuid(),
  data: {
    resourcePath: faker.system.filePath(),
    expirationDate: faker.date.past().toISOString(),
  },
});
```

## Coverage

Coverage reports are generated in multiple formats:

- `text` - Terminal output
- `html` - Browse at `coverage/index.html`
- `lcov` - For CI integration

### Coverage Thresholds

Configure in `vitest.config.mts` if needed:

```typescript
coverage: {
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 80,
    statements: 80,
  },
}
```

## Best Practices

1. **Unit test business logic** - Focus on managers and services
2. **Mock external dependencies** - SDK, logger, config
3. **Use descriptive test names** - `should <expected behavior> when <condition>`
4. **Keep tests isolated** - No shared state between tests
5. **Test error cases** - Validate error handling paths
6. **Use beforeEach for setup** - Reset mocks and create fresh instances
