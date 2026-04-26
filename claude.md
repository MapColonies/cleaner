# TaskPoller Bridge Implementation Instructions

## Goal

Implement a `TaskPoller` class that bridges the old `mc-priority-queue` SDK with the new `jobnik-sdk` `IWorker` interface. This allows the current codebase to conform to the new SDK's interface so that future migration is minimal.

## Context

- **Old SDK**: `@map-colonies/mc-priority-queue` — provides `TaskHandler` (QueueClient) with `dequeue(jobType, taskType)`, `ack(jobId, taskId)`, `reject(jobId, taskId, isRecoverable, reason)`, and `jobManagerClient.getJob(jobId)`. The old SDK manages heartbeats internally on dequeue.
- **New SDK**: `@map-colonies/jobnik-sdk` — provides `IWorker` interface with `start()`, `stop()`, `on()`, `off()`, `once()`, `removeAllListeners()`, and emits `WorkerEvents`. The new SDK's `createWorker(stageType, handler, options)` takes a single stage type and a typed task handler.
- **Bridge pattern**: Our `TaskPoller` implements `IWorker` from the new SDK but uses the old `QueueClient` under the hood for all job-manager communication.

## Architecture Overview

```
workerBuilder (tsyringe factory)
  └── TaskPoller (implements IWorker, extends EventEmitter)
        ├── Uses QueueClient.dequeue() to poll for tasks
        ├── Uses QueueClient.ack() / reject() for task lifecycle
        ├── Uses QueueClient.jobManagerClient.getJob() to fetch job context
        ├── Emits WorkerEvents (started, stopped, taskStarted, taskCompleted, etc.)
        ├── Supports concurrency control
        └── Graceful shutdown with abort signal
```

## Files to Create

### 1. `src/worker/taskPoller.ts` — Core polling worker

**Class: `TaskPoller extends EventEmitter implements IWorker`**

**Constructor config interface:**

```typescript
interface TaskPollerConfig {
  logger: Logger; // @map-colonies/js-logger
  queueClient: QueueClient; // mc-priority-queue TaskHandler
  pollingPairs: PollingPairConfig[]; // from buildPollingPairs()
  dequeueIntervalMs: number; // polling sleep interval
  taskHandler: TaskHandler; // the user-defined processing function (new SDK type)
  workerOptions?: { concurrency?: number };
}
```

**Internal state:**

- `isRunning: boolean` — whether the poll loop is active
- `isStopping: boolean` — whether graceful shutdown has been requested
- `runningTaskCount: number` — number of in-flight tasks
- `stopResolve: (() => void) | null` — resolve function for the stop() promise
- `concurrency: number` — max concurrent tasks (default 1)
- `abortController: AbortController` — used to interrupt sleep on shutdown

**Methods to implement:**

#### `start(): Promise<void>`

- Guard against double-start (if already running, log warning and return)
- Set `isRunning = true`, `isStopping = false`
- Emit `'started'` event with `{ stageType, concurrency }`
- Call `pollLoop()` in a try/finally
- In finally: set `isRunning = false`, emit `'stopped'` event
- The `stageType` label is derived from polling pairs: `pairs.map(p => '${p.jobType}/${p.taskType}').join(',')`

#### `stop(): Promise<void>`

- Guard: if not running or already stopping, return immediately
- Set `isStopping = true`
- Call `abortController.abort()` to interrupt any sleeping poll
- Emit `'stopping'` event with `{ stageType, runningTasks: this.runningTaskCount }`
- If `runningTaskCount > 0`, return a new Promise whose resolve is stored in `stopResolve`
- The resolve will be called from `processTask`'s finally block when count hits 0

#### `on/off/once/removeAllListeners`

- Delegate to `super` (EventEmitter) with proper generic typing for `WorkerEvents`

#### `pollLoop(): Promise<void>` (private)

- Track `consecutiveEmptyPolls` counter
- While `isRunning && !isStopping`:
  1. If `runningTaskCount >= concurrency`, sleep 100ms and continue
  2. Call `tryDequeue()` to attempt getting a task
  3. If no task: increment `consecutiveEmptyPolls`, emit `'queueEmpty'` event, sleep `dequeueIntervalMs`, continue
  4. If task found: reset `consecutiveEmptyPolls` to 0
  5. Call `processTask(task, jobId, jobType, taskType)`
  6. If `concurrency === 1`, await the processTask promise. Otherwise fire-and-forget (the promise manages its own lifecycle via runningTaskCount)

#### `tryDequeue(): Promise<{task, jobId, jobType, taskType} | undefined>` (private)

- Iterate over all `pollingPairs`
- For each pair, if `isStopping` return undefined
- Call `queueClient.dequeue<unknown>(pair.jobType, pair.taskType)`
- If task returned, log and return `{ task, jobId: task.jobId, jobType, taskType }`
- On error: log error, emit `'error'` event with `{ location: 'dequeue', error, stageType }`, continue to next pair
- If all pairs empty, return undefined

#### `processTask(task, jobId, jobType, taskType): Promise<void>` (private)

- Increment `runningTaskCount`
- Record `startTime = Date.now()`
- Emit `'taskStarted'` event
- In try block:
  1. Call `checkTaskAttempts(task, jobType, taskType)` — throws UnrecoverableTaskError if exceeded
  2. Fetch full job: `await queueClient.jobManagerClient.getJob<unknown, unknown>(jobId)`
  3. Build a partial `TaskHandlerContext` with `{ signal: abortController.signal, logger, job }`
  4. Call `taskHandler(task as any, context as any)` — the `as any` bridges old/new type shapes
  5. Call `queueClient.ack(jobId, taskId)`
  6. Emit `'taskCompleted'` with `{ taskId, stageType, duration }`
- In catch block:
  1. Emit `'taskFailed'` with `{ taskId, stageType, error }`
  2. Determine recoverability: `!(error instanceof UnrecoverableTaskError)`
  3. Extract reason string from error
  4. Call `queueClient.reject(jobId, taskId, isRecoverable, reason)`
  5. Wrap reject in its own try/catch — on failure, log and emit `'error'`
- In finally block:
  1. Decrement `runningTaskCount`
  2. If `isStopping && runningTaskCount === 0 && stopResolve`, call `stopResolve()` and set to null

#### `checkTaskAttempts(task, jobType, taskType): void` (private)

- Find matching polling pair by jobType + taskType
- If `task.attempts >= pair.maxAttempts`, throw `UnrecoverableTaskError`

#### `sleep(ms): Promise<void>` (private)

- Use `setTimeout` from `timers/promises` with `{ signal: abortController.signal }`
- Wrap in try/catch — swallow AbortError (expected during shutdown)

**Also define in this file:**

- `UnrecoverableTaskError extends Error` — custom error class for non-retryable failures

### 2. `src/worker/workerBuilder.ts` — tsyringe factory

```typescript
export const workerBuilder: FactoryFunction<IWorker> = (container) => {
  // Resolve dependencies
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<IConfig>(SERVICES.CONFIG);
  const queueClient = container.resolve<QueueClient>(SERVICES.QUEUE_CLIENT);
  const taskHandler = container.resolve<TaskHandler>(SERVICES.TASK_HANDLER);
  const pollingPairs = container.resolve<PollingPairConfig[]>(SERVICES.POLLING_PAIRS);

  // Read config values
  const dequeueIntervalMs = config.get<number>('jobManagement.config.dequeueIntervalMs');
  const concurrency = config.get<number>('jobManagement.config.concurrency') ?? 1;

  // Create and return the poller
  const poller = new TaskPoller({
    logger,
    queueClient,
    pollingPairs,
    dequeueIntervalMs,
    taskHandler,
    workerOptions: { concurrency },
  });

  return poller;
};
```

### 3. DI Container Registration (in existing containerConfig)

Ensure these tokens are registered:

- `SERVICES.QUEUE_CLIENT` — the old mc-priority-queue `TaskHandler` instance
- `SERVICES.TASK_HANDLER` — the user's task processing function (typed as new SDK's `TaskHandler`)
- `SERVICES.POLLING_PAIRS` — result of `buildPollingPairs(jobDefinitions, capabilities)`
- Register the worker: `container.register(SERVICES.WORKER, { useFactory: workerBuilder })`

Add to `SERVICES` constants if not present:

- `TASK_HANDLER: Symbol('TaskHandler')`
- `POLLING_PAIRS: Symbol('PollingPairs')`
- `WORKER: Symbol('Worker')`

## Important Design Decisions

1. **Type bridging with `as any`**: The old SDK's `ITaskResponse<T>` doesn't match the new SDK's `Task<T>` type exactly. Use `as any` at the boundary when calling `taskHandler`. Document this as a known migration point. When the new SDK is adopted, these casts are removed.

2. **Partial TaskHandlerContext**: The new SDK's context has `producer`, `apiClient`, `stage`, `updateJobUserMetadata`, `updateStageUserMetadata`, `updateTaskUserMetadata`. We only provide `signal`, `logger`, and `job` for now. The task handler should be written to only depend on what's available, or check for existence. Document the missing fields.

3. **Heartbeat management**: The old `QueueClient.dequeue()` automatically starts heartbeats and `ack()`/`reject()` stops them. We don't need to manage this ourselves.

4. **No circuit breakers yet**: The `WorkerOptions` interface includes circuit breaker config, but we're deferring that. The polling loop uses simple try/catch for now.

5. **Concurrency model**: For `concurrency === 1`, the poll loop awaits each task before polling again. For `concurrency > 1`, tasks are fire-and-forget with the `runningTaskCount` semaphore preventing over-scheduling.

## Migration Path to New SDK

When the new SDK is ready, the migration involves:

1. Replace `TaskPoller` usage with `sdk.createWorker(stageType, handler, options)`
2. Remove the `QueueClient` dependency
3. Remove `pollingPairs` — the new SDK resolves these internally from stage type
4. The `workerBuilder` becomes ~10 lines (see the new SDK example in context)
5. Task handlers that already conform to the new SDK's `TaskHandler` type work without changes
6. Event listeners (`worker.on(...)`) work identically — same `WorkerEvents` interface

## Testing Guidelines

### Do not assert on log calls

Logger calls are implementation details that change frequently without changing behavior. Never use `expect(logger.info/debug/warn/error).toHaveBeenCalledWith(...)` as a test assertion. Assert on observable outcomes instead: return values, thrown errors, calls to collaborators (ack, reject, handleError, resolveWithContext, etc.).

### Do not use `as any` in test files

Use the typed mock factories from `tests/helpers/mocks.ts` (`createMockQueueClient`, `createMockStrategyFactory`, `createMockErrorHandler`, `createMockConfig`). These return intersection types (`MockXxx & RealType`) so mock methods (`.mockResolvedValue`, `.mockReturnValue`, etc.) are available without casting. All `as unknown as RealType` casting is contained inside `createTaskPoller()` in `mocks.ts` and must not appear in test files.

### One test file per class

Do not split a single class's tests into multiple files by method or scenario group. Keep all tests for a class in one `tests/<area>/<ClassName>.spec.ts` file, organized with nested `describe` blocks.

### Keep test count focused

Only write tests that cover distinct branches, error paths, or behavioral contracts. Avoid redundant tests that cover the same code path with slightly different data. Prefer one well-named test per branch over multiple tests for the same branch.

## Testing Notes

- The `start()` method with `pollLoop` can be tested using a mock `QueueClient` that returns tasks on demand
- Test graceful shutdown by calling `stop()` while a task is in-flight
- Test concurrency by providing a slow task handler and verifying multiple tasks run simultaneously
- Test max attempts by providing a task with `attempts >= maxAttempts` and verifying it's rejected as unrecoverable
- Test empty queue backoff by providing a mock that always returns null and verifying `queueEmpty` events with incrementing `consecutiveEmptyPolls`
