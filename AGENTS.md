# AI Agent Instructions - Cleaner Worker Service

## Project Overview

**Cleaner** is a TypeScript-based worker service built on the MapColonies Jobnik SDK framework. It is a distributed task processing worker that handles cleanup operations as part of the raster processing pipeline.

This project is based on the `cleaner` template and follows the MapColonies ecosystem conventions for observability, configuration, and deployment.

## Quick Reference

| Aspect          | Details                      |
| --------------- | ---------------------------- |
| Runtime         | Node.js >= 24.0.0            |
| Language        | TypeScript 5.x (strict mode) |
| Task Processing | @map-colonies/jobnik-sdk     |
| DI Framework    | tsyringe                     |
| Test Framework  | Vitest                       |

## Documentation

For detailed information, refer to the documentation in `ai-docs/`:

| Document                                         | Description                                          |
| ------------------------------------------------ | ---------------------------------------------------- |
| [build-system.md](ai-docs/build-system.md)       | Build pipeline, TypeScript config, Docker build      |
| [code-style.md](ai-docs/code-style.md)           | Naming conventions, linting, formatting rules        |
| [common-patterns.md](ai-docs/common-patterns.md) | DI patterns, task handling, configuration access     |
| [git-workflow.md](ai-docs/git-workflow.md)       | Branch strategy, commit conventions, release process |
| [packages.md](ai-docs/packages.md)               | Dependencies, MapColonies ecosystem packages         |
| [testing.md](ai-docs/testing.md)                 | Vitest setup, mocking, coverage                      |

## Project Structure

```
src/
  index.ts              # Application entry point
  containerConfig.ts    # Dependency injection setup
  worker.ts             # Worker factory function
  common/               # Shared utilities and constants
  logistics/            # Example code (replace with cleaner/)

config/                 # Environment-specific configuration
tests/                  # Vitest test files
ai-docs/                # Detailed AI agent documentation
```

## Key Commands

```bash
npm run start:dev     # Development mode with offline config
npm run build         # Production build
npm test              # Run tests with coverage
npm run lint:fix      # Auto-fix linting issues
```

## Important Notes for AI Agents

1. **Incremental Commits & PRs**: Always implement changes in small commits grouped into reviewable PRs. After implementing each part:
   - Stage files with `git add`
   - Stop and wait for user confirmation before committing
   - Only commit after explicit user approval
   - Use conventional commits: `<type>(<scope>): <description>`
   - When enough commits are accumulated (3-5 related commits), STOP and tell user to create PR before continuing

2. **Remove Demo Code**: The `logistics/` folder and `seeder.ts` are examples. Replace with actual cleaner implementation.

3. **Package Metadata**: Update `package.json` name from `cleaner` to `cleaner`.

4. **Type Safety**: Define job/stage types in `src/cleaner/types.ts` and update `worker.ts` with correct generic parameters.

5. **Path Aliases**: Use `@common/` for imports from `src/common/`.

6. **Endpoints**: `/metrics` (Prometheus), `/liveness` (health check).

## Common Tasks

### Adding a New Task Handler

1. Define types in `src/cleaner/types.ts`
2. Create manager in `src/cleaner/manager.ts` with `@injectable()`
3. Update `worker.ts` to create worker for your stage
4. See [common-patterns.md](ai-docs/common-patterns.md) for examples

### Adding Configuration

1. Add to `config/default.json`
2. Access via `config.get('path.to.value')`
3. See [common-patterns.md](ai-docs/common-patterns.md#configuration-access)

### Writing Tests

1. Create `tests/*.spec.ts` files
2. Use Vitest with `describe`, `it`, `expect`
3. See [testing.md](ai-docs/testing.md) for patterns
