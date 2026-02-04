# Build System

## Overview

The project uses TypeScript with SWC for fast compilation and follows a standard Node.js build pipeline.

## Build Commands

| Command             | Description                                      |
| ------------------- | ------------------------------------------------ |
| `npm run build`     | Production build (clean → compile → copy assets) |
| `npm run clean`     | Remove `dist/` directory                         |
| `npm run start`     | Build and run production server                  |
| `npm run start:dev` | Build and run with offline config + source maps  |

## Build Pipeline

```
npm run build
  └── npm run prebuild (clean)
      └── rimraf dist
  └── tsc --project tsconfig.build.json
  └── tsc-alias -p tsconfig.build.json
  └── npm run assets:copy
      └── copyfiles -f ./config/* ./dist/config
      └── copyfiles ./package.json dist
```

## TypeScript Configuration

### tsconfig.json (Development)

- Strict mode enabled
- Path aliases configured (`@common/` → `src/common/`)
- ES modules target

### tsconfig.build.json (Production)

- Excludes test files
- Outputs to `dist/`
- Generates declaration files

## Path Aliases

```json
{
  "paths": {
    "@common/*": ["src/common/*"]
  }
}
```

Use in imports:

```typescript
import { SERVICES } from '@common/constants';
import { ConfigType } from '@common/config';
```

## SWC Configuration

The `.swcrc` file configures SWC for fast TypeScript compilation with decorator support (required for tsyringe).

## Output Structure

```
dist/
  index.js              # Entry point
  instrumentation.mjs   # OpenTelemetry instrumentation
  containerConfig.js
  worker.js
  common/
  config/               # Copied from config/
  package.json          # Copied for runtime
```

## Environment Variables

| Variable              | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `CONFIG_OFFLINE_MODE` | Set to `true` for local development without config server            |
| `NODE_ENV`            | Determines which config file to load (development, production, test) |

## Docker Build

Multi-stage Dockerfile:

1. **Builder stage**: Installs dependencies, compiles TypeScript
2. **Production stage**: Copies only production artifacts, runs as non-root user

```bash
docker build -t cleaner .
docker run -p 8080:8080 cleaner
```
