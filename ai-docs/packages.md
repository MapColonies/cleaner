# Packages & Dependencies

## Runtime Dependencies

### Core Framework

| Package                    | Version | Purpose                             |
| -------------------------- | ------- | ----------------------------------- |
| `@map-colonies/jobnik-sdk` | ^0.1.0  | Distributed task processing SDK     |
| `@map-colonies/config`     | ^3.0.0  | Configuration management            |
| `express`                  | ^4.21.2 | HTTP server framework               |
| `@godaddy/terminus`        | ^4.12.1 | Health checks and graceful shutdown |

### Dependency Injection

| Package            | Version | Purpose                                   |
| ------------------ | ------- | ----------------------------------------- |
| `tsyringe`         | ^4.8.0  | IoC container                             |
| `reflect-metadata` | ^0.2.2  | Decorator metadata (required by tsyringe) |

### Observability

| Package                   | Version | Purpose                              |
| ------------------------- | ------- | ------------------------------------ |
| `@map-colonies/js-logger` | ^3.0.2  | Structured JSON logging (Pino-based) |
| `@map-colonies/telemetry` | ^10.0.1 | OpenTelemetry tracing                |
| `@opentelemetry/api`      | ^1.9.0  | OpenTelemetry API                    |
| `prom-client`             | ^15.1.3 | Prometheus metrics                   |

### Utilities

| Package                  | Version | Purpose                   |
| ------------------------ | ------- | ------------------------- |
| `@map-colonies/read-pkg` | ^1.0.0  | Read package.json         |
| `@map-colonies/schemas`  | ^1.13.0 | Shared schema definitions |
| `compression`            | ^1.8.0  | HTTP response compression |

## Development Dependencies

### TypeScript & Build

| Package                  | Purpose                              |
| ------------------------ | ------------------------------------ |
| `typescript`             | TypeScript compiler                  |
| `@map-colonies/tsconfig` | Shared TypeScript config             |
| `tsc-alias`              | Path alias resolution in output      |
| `copyfiles`              | Copy assets to dist                  |
| `rimraf`                 | Cross-platform rm -rf                |
| `cross-env`              | Cross-platform environment variables |

### Testing

| Package               | Purpose              |
| --------------------- | -------------------- |
| `vitest`              | Test runner          |
| `@vitest/coverage-v8` | Code coverage        |
| `@vitest/ui`          | Test UI dashboard    |
| `@faker-js/faker`     | Test data generation |

### Linting & Formatting

| Package                         | Purpose                |
| ------------------------------- | ---------------------- |
| `eslint`                        | Linting                |
| `@map-colonies/eslint-config`   | Shared ESLint config   |
| `prettier`                      | Code formatting        |
| `@map-colonies/prettier-config` | Shared Prettier config |

### Git Hooks & Commits

| Package                           | Purpose                      |
| --------------------------------- | ---------------------------- |
| `husky`                           | Git hooks                    |
| `pretty-quick`                    | Run Prettier on staged files |
| `@commitlint/cli`                 | Commit message linting       |
| `@map-colonies/commitlint-config` | Shared commitlint config     |

### Types

| Package          | Purpose                  |
| ---------------- | ------------------------ |
| `@types/express` | Express type definitions |
| `type-fest`      | TypeScript utility types |

## MapColonies Ecosystem

This project uses several `@map-colonies` packages that follow ecosystem conventions:

### @map-colonies/jobnik-sdk

- Creates workers that poll for tasks
- Type-safe job and stage definitions
- Built-in error handling and retries

### @map-colonies/config

- Extends node-config pattern
- Supports config server integration
- Schema validation

### @map-colonies/js-logger

- Pino-based structured logging
- OpenTelemetry mixin support
- Pretty print for development

### @map-colonies/telemetry

- OpenTelemetry instrumentation
- Prometheus metrics middleware
- Distributed tracing

## Adding Dependencies

```bash
# Production dependency
npm install <package-name>

# Development dependency
npm install -D <package-name>
```

## Updating Dependencies

```bash
# Check for updates
npm outdated

# Update to latest within semver range
npm update

# Update specific package
npm install <package-name>@latest
```

## Node.js Version

- **Required**: >= 24.0.0
- Specified in `package.json` engines and `.nvmrc`

```bash
# Use correct Node version with nvm
nvm use
```
