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
