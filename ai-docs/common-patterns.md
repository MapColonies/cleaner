# Common Patterns

## Dependency Injection

### Service Registration

Services are registered in `containerConfig.ts`:

```typescript
import { registerDependencies } from '@common/dependencyRegistration';
import { SERVICES } from '@common/constants';

const dependencies: InjectionObject<unknown>[] = [
  { token: SERVICES.CONFIG, provider: { useValue: configInstance } },
  { token: SERVICES.LOGGER, provider: { useValue: logger } },
  {
    token: SERVICES.MY_SERVICE,
    provider: {
      useFactory: instancePerContainerCachingFactory((container) => {
        // Factory function with access to container
        return new MyService(container.resolve(SERVICES.LOGGER));
      }),
    },
  },
];

return registerDependencies(dependencies);
```

### Creating Injectable Services

```typescript
import { injectable, inject } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';

@injectable()
export class CleanerService {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) private readonly config: ConfigType
  ) {}

  public async cleanup(resourceId: string): Promise<void> {
    this.logger.info({ msg: 'Starting cleanup', resourceId });
    // Implementation
  }
}
```

### Adding New Service Tokens

In `common/constants.ts`:

```typescript
export const SERVICES = {
  CONFIG: Symbol('Config'),
  LOGGER: Symbol('Logger'),
  TRACER: Symbol('Tracer'),
  METRICS: Symbol('Metrics'),
  JOBNIK_SDK: Symbol('JobnikSDK'),
  WORKER: Symbol('Worker'),
  // Add new tokens here
  CLEANER_SERVICE: Symbol('CleanerService'),
} satisfies Record<string, symbol>;
```

**Note**: Strategy classes are registered using their task type string directly (e.g., `'tiles-deletion'`) rather than Symbol tokens. This eliminates the need for an additional mapping layer.

## Task Handling

### Task Handler Structure

```typescript
import type { Task, TaskHandlerContext } from '@map-colonies/jobnik-sdk';
import { injectable } from 'tsyringe';
import type { CleanerJobTypes, CleanerStageTypes } from './types';

@injectable()
export class CleanerManager {
  public async handleCleanupTask(
    task: Task<CleanerStageTypes['cleanup']['task']>,
    context: TaskHandlerContext<CleanerJobTypes, CleanerStageTypes, 'cleanerJob', 'cleanup'>
  ): Promise<void> {
    const { logger, job } = context;

    logger.info({ msg: 'Processing cleanup task', taskId: task.id });

    // Access task data
    const { resourcePath, expirationDate } = task.data;

    // Access job metadata
    const jobMetadata = job.userMetadata;

    // Do work...

    // Update stage metadata on success
    await context.updateStageUserMetadata({
      cleanedAt: new Date().toISOString(),
    });
  }
}
```

### Type Definitions

```typescript
import type { IJobnikSDK } from '@map-colonies/jobnik-sdk';

export interface CleanerJobTypes {
  cleanerJob: {
    data: {
      targetPath: string;
      retentionDays: number;
    };
    userMetadata: {
      initiatedBy: string;
      scheduledAt: string;
    };
  };
}

export interface CleanerStageTypes {
  cleanup: {
    data: { batchSize: number };
    userMetadata: { cleanedAt?: string };
    task: {
      data: { resourcePath: string; expirationDate: string };
      userMetadata: { status?: string };
    };
  };
}

export type CleanerSDK = IJobnikSDK<CleanerJobTypes, CleanerStageTypes>;
```

### Worker Factory

```typescript
export const workerBuilder: FactoryFunction<IWorker> = (container) => {
  const sdk = container.resolve<CleanerSDK>(SERVICES.JOBNIK_SDK);
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);
  const manager = container.resolve(CleanerManager);

  const worker = sdk.createWorker<'cleanerJob', 'cleanup'>('cleanup', manager.handleCleanupTask.bind(manager), config.get('jobnik.worker'));

  worker.on('error', (err) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    logger.error({ msg: 'Worker error', err });
  });

  return worker;
};
```

## Configuration Access

### Reading Configuration

```typescript
@injectable()
export class MyService {
  public constructor(@inject(SERVICES.CONFIG) private readonly config: ConfigType) {}

  public getServerPort(): number {
    return this.config.get('server.port');
  }
}
```

### Configuration Structure

```
config/
  default.json                   # Base config (always loaded)
  development.json               # Merged when NODE_ENV=development
  production.json                # Merged when NODE_ENV=production
  test.json                      # Merged when NODE_ENV=test
  local.json                     # Local overrides (gitignored)
  custom-environment-variables.json  # Environment variable mappings
helm/
  values.yaml                    # Helm chart default values
  local.yaml                     # Local Helm overrides (gitignored)
  templates/configmap.yaml       # ConfigMap template
```

### Adding New Configuration Values

**IMPORTANT**: When adding new configuration values, you MUST update ALL configuration files to maintain sync across all deployment levels:

1. **`config/default.json`** - Add the configuration with default values
2. **`config/custom-environment-variables.json`** - Add environment variable mappings
3. **`helm/values.yaml`** - Add Helm chart values
4. **`helm/values-local.yaml`** - Add local development values (if needed)
5. **`helm/templates/configmap.yaml`** - Add to ConfigMap template

**Example:**

Adding a new `queue.jobManagerBaseUrl` configuration:

**1. config/default.json**

```json
{
  "queue": {
    "jobManagerBaseUrl": "http://job-manager:8080"
  }
}
```

**2. config/custom-environment-variables.json**

```json
{
  "queue": {
    "jobManagerBaseUrl": "QUEUE_JOB_MANAGER_BASE_URL"
  }
}
```

**3. helm/values.yaml**

```yaml
env:
  queue:
    jobManagerBaseUrl: 'http://job-manager:8080'
```

**4. helm/local.yaml** (for local development)

```yaml
env:
  queue:
    jobManagerBaseUrl: 'http://localhost:8080'
```

**5. helm/templates/configmap.yaml**

```yaml
data:
  QUEUE_JOB_MANAGER_BASE_URL: { { .Values.env.queue.jobManagerBaseUrl | quote } }
```

This ensures configuration works correctly in:

- Local development (default.json, local.json)
- CI/CD environments (environment variables)
- Kubernetes deployments (Helm charts)

## Error Handling

### In Task Handlers

Throwing an error automatically fails the task:

```typescript
public async handleTask(task: Task<...>, context: ...): Promise<void> {
  if (!task.data.resourcePath) {
    throw new Error('Resource path is required');
  }

  try {
    await this.processResource(task.data.resourcePath);
  } catch (error) {
    context.logger.error({ msg: 'Processing failed', error });
    throw error; // Task will be marked as failed
  }
}
```

### Structured Logging

```typescript
// Good - structured context
logger.info({ msg: 'Task started', taskId: task.id, resourcePath });
logger.error({ msg: 'Task failed', error, taskId: task.id });

// Avoid - string concatenation
logger.info(`Task ${task.id} started`);
```

## Graceful Shutdown

The `onSignal` handler in `containerConfig.ts` handles cleanup:

```typescript
{
  token: 'onSignal',
  provider: {
    useFactory: (container) => {
      const worker = container.resolve<IWorker>(SERVICES.WORKER);
      return async (): Promise<void> => {
        await Promise.all([
          getTracing().stop(),
          worker.stop(),
          // Add additional cleanup here
        ]);
      };
    },
  },
}
```
