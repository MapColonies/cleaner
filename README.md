# Jobnik Worker Boilerplate

A production-ready TypeScript boilerplate for building distributed task workers using the MapColonies Jobnik SDK.

## Features

- **Type-safe task handling** with full TypeScript support for job and stage definitions
- **Built-in observability** with distributed tracing, Prometheus metrics, and structured logging
- **Production-ready containerization** with multi-stage Docker builds and Helm charts
- **Dependency injection** using tsyringe for clean, testable architecture
- **Health checks and graceful shutdown** with @godaddy/terminus
- **Comprehensive testing** setup with Vitest for unit and integration tests

## Prerequisites

- Node.js >= 24.0.0
- Connection to a Jobnik Job Manager API instance

## Installation

```bash
npm install
```

## Configuration

Configure the worker by editing files in the `config/` directory:

- `default.json` - Base configuration
- `development.json` - Development overrides
- `production.json` - Production overrides
- `test.json` - Test environment settings
- `local.json` - Local overrides (not committed to version control)

Set the Jobnik Job Manager API URL via Helm values or environment variables.

## Quick Start

### Development Mode

```bash
npm run start:dev
```

Development mode enables offline config mode and source map support for better debugging.

### Production Build

```bash
npm run build
npm start
```

### Running Tests

```bash
# Run all tests with coverage
npm test

# Watch mode for development
npm run test:watch
```

## Customizing the Boilerplate

This boilerplate includes example "logistics" code to demonstrate task handling. Follow these steps to adapt it to your use case:

### 1. Remove Example Code

Delete the example logistics implementation:

```bash
rm -rf src/logistics src/seeder.ts tests/logistics.spec.ts
```

Remove the seeder call from `src/index.ts`:

```typescript
// REMOVE THESE LINES:
const sdk = container.resolve<LogisticsSDK>(SERVICES.JOBNIK_SDK);
await seedData(sdk.getProducer());
```

### 2. Define Your Job and Stage Types

Create a new types file (e.g., `src/yourDomain/types.ts`):

```typescript
import type { IJobnikSDK } from '@map-colonies/jobnik-sdk';

export interface YourJobTypes {
  jobType1: {
    data: { /* your job data schema */ };
    userMetadata: { /* your job metadata */ };
  };
}

export interface YourStageTypes {
  stage1: {
    data: { /* stage data schema */ };
    userMetadata: { /* stage metadata */ };
    task: { 
      data: { /* task data schema */ }; 
      userMetadata: { /* task metadata */ } 
    };
  };
}

export type YourSDK = IJobnikSDK<YourJobTypes, YourStageTypes>;
```

### 3. Create Task Handler

Create your manager (e.g., `src/yourDomain/manager.ts`):

```typescript
import { injectable } from 'tsyringe';
import type { Task, TaskHandlerContext } from '@map-colonies/jobnik-sdk';

@injectable()
export class YourManager {
  public async handleYourTask(
    task: Task<YourStageTypes['stage1']['task']>,
    context: TaskHandlerContext<YourJobTypes, YourStageTypes, 'jobType1', 'stage1'>
  ): Promise<void> {
    context.logger.info({ msg: 'Processing task', taskId: task.id });
    
    // Your task processing logic here
    
    await context.updateStageUserMetadata({ /* updated metadata */ });
  }
}
```

### 4. Update Worker Configuration

Modify `src/worker.ts` to use your new types and handler:

```typescript
import { YourManager } from './yourDomain/manager';
import type { YourSDK } from './yourDomain/types';

export const workerBuilder: FactoryFunction<IWorker> = (container: DependencyContainer) => {
  const sdk = container.resolve<YourSDK>(SERVICES.JOBNIK_SDK);
  const manager = container.resolve(YourManager);
  
  const worker = sdk.createWorker<'jobType1', 'stage1'>(
    'stage1',
    manager.handleYourTask.bind(manager),
    config.get('jobnik.worker')
  );
  
  return worker;
};
```

### 5. Rename Throughout the Project

Update references to `jobnik-worker-boilerplate` in:
- `package.json` - name, description, author
- `helm/Chart.yaml` - name, description
- `helm/values.yaml` - mclabels, configManagement.name, image.repository
- `helm/templates/_helpers.tpl` - all template definitions
- `helm/templates/*.yaml` - review all template files for hardcoded references

### 6. Update Package Metadata

Edit `package.json`:

```json
{
  "name": "your-worker-name",
  "description": "Your worker description",
  "author": "Your Team"
}
```

## Observability

### Metrics

Prometheus metrics are exposed on the `/metrics` endpoint (default port 8080). Key metrics include:

- Worker task processing duration
- Task success/failure rates
- Active task count
- Custom application metrics

### Tracing

Distributed tracing can be enabled in `config/default.json`:

```json
{
  "telemetry": {
    "tracing": {
      "isEnabled": true,
      "url": "http://your-otlp-collector:4318/v1/trace"
    }
  }
}
```

### Logging

Structured JSON logging is provided by `@map-colonies/js-logger`. Configure log level:

```json
{
  "telemetry": {
    "logger": {
      "level": "info",
      "prettyPrint": false
    }
  }
}
```

## Deployment

### Kubernetes/Helm

Deploy using Helm:

```bash
helm install your-worker-name ./helm
```

## Documentation

- [Jobnik SDK Documentation](https://github.com/MapColonies/jobnik-sdk)
- [@map-colonies/telemetry](https://github.com/MapColonies/telemetry)
- [@map-colonies/js-logger](https://github.com/MapColonies/js-logger)
- [@map-colonies/config](https://github.com/MapColonies/config)


