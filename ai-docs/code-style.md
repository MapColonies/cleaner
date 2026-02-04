# Code Style

## Linting & Formatting

The project uses ESLint 9 with Prettier integration.

### Commands

| Command              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `npm run lint`       | Check for linting errors (runs Prettier first) |
| `npm run lint:fix`   | Auto-fix linting and formatting issues         |
| `npm run format`     | Check Prettier formatting                      |
| `npm run format:fix` | Auto-fix Prettier formatting                   |

### Configuration Files

- `eslint.config.mjs` - ESLint 9 flat config
- `.prettierrc` - Prettier configuration (extends `@map-colonies/prettier-config`)
- `.editorconfig` - Editor settings

## Naming Conventions

| Element            | Convention       | Example                                  |
| ------------------ | ---------------- | ---------------------------------------- |
| Files              | kebab-case       | `container-config.ts`, `task-handler.ts` |
| Classes            | PascalCase       | `CleanerManager`, `TaskHandler`          |
| Interfaces         | PascalCase       | `ConfigType`, `TaskData`                 |
| Functions/Methods  | camelCase        | `handleTask`, `getConfig`                |
| Constants (tokens) | UPPER_SNAKE_CASE | `SERVICES`, `SERVICE_NAME`               |
| Constants (values) | camelCase        | `defaultTimeout`                         |
| Type aliases       | PascalCase       | `CleanerSDK`, `JobTypes`                 |

## TypeScript Guidelines

### Use Type Imports

```typescript
// Prefer type imports for type-only usage
import type { Logger } from '@map-colonies/js-logger';
import type { Task, TaskHandlerContext } from '@map-colonies/jobnik-sdk';

// Regular imports for values
import { injectable } from 'tsyringe';
```

### Explicit Return Types

```typescript
// Always specify return types for public methods
public async handleTask(task: Task<TaskData>): Promise<void> {
  // ...
}

// Private methods can use inference
private parseData(raw: string) {
  return JSON.parse(raw);
}
```

### Strict Mode Compliance

- No implicit `any`
- Strict null checks
- No unused locals/parameters
- Explicit property initialization

## Code Organization

### File Structure

```typescript
// 1. Imports (grouped: node, external, internal)
import { setTimeout } from 'node:timers/promises';
import type { Logger } from '@map-colonies/js-logger';
import { injectable } from 'tsyringe';
import { SERVICES } from '@common/constants';

// 2. Types/Interfaces (if file-local)
interface LocalType {
  // ...
}

// 3. Constants
const DEFAULT_TIMEOUT = 5000;

// 4. Main export (class/function)
@injectable()
export class MyService {
  // ...
}
```

### Import Order

1. Node.js built-ins (`node:*`)
2. External packages (`@map-colonies/*`, `tsyringe`, etc.)
3. Internal modules (`@common/*`, `./local`)

## Comments

- Use JSDoc for public APIs
- Inline comments for complex logic only
- TODO format: `// TODO: description`

```typescript
/**
 * Handles cleanup tasks for expired resources.
 * @param task - The task containing cleanup parameters
 * @param context - Task execution context with logger and metadata
 */
public async handleCleanupTask(
  task: Task<CleanupTaskData>,
  context: TaskHandlerContext<...>
): Promise<void> {
  // ...
}
```
