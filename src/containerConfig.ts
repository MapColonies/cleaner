import { IWorker, JobnikSDK } from '@map-colonies/jobnik-sdk';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { SourceType } from '@map-colonies/raster-shared';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { Registry } from 'prom-client';
import { instancePerContainerCachingFactory } from 'tsyringe';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import { SERVICE_NAME, SERVICES } from '@common/constants';
import { getJobAndTaskToken, InjectionObject, registerDependencies } from '@common/dependencyRegistration';
import { getTracing } from '@common/tracing';
import type { StorageProviders } from '@src/cleaner/storageProviders';
import { ErrorHandler } from './cleaner/errors';
import { JobTrackerClient } from './cleaner/httpClients';
import { buildFsStorageConfig, buildS3StorageConfig, FsStorageProvider, S3StorageProvider } from './cleaner/storageProviders';
import { DeleteStoredResourcesStrategy, StrategyFactory, TilesDeletionStrategy } from './cleaner/strategies';
import type { QueueConfig } from './cleaner/types';
import { ConfigType, getConfig } from './common/config';
import { workerBuilder } from './worker';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const configInstance = getConfig();

  const loggerConfig = configInstance.get('telemetry.logger');

  const logger = await jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });

  const tracer = trace.getTracer(SERVICE_NAME);
  const metricsRegistry = new Registry();
  configInstance.initializeMetrics(metricsRegistry);

  // Startup validations
  const cleanupStorageProviders = configInstance.get('storage.cleanupStorageProviders') as unknown as string[];
  const fsStorageConfig = cleanupStorageProviders.includes(SourceType.FS) ? buildFsStorageConfig(configInstance, logger) : undefined;
  const s3StorageConfig = cleanupStorageProviders.includes(SourceType.S3) ? buildS3StorageConfig(configInstance, logger) : undefined;

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: configInstance } },
    { token: SERVICES.LOGGER, provider: { useValue: logger } },
    { token: SERVICES.TRACER, provider: { useValue: tracer } },
    { token: SERVICES.METRICS, provider: { useValue: metricsRegistry } },
    {
      token: SERVICES.JOBNIK_SDK,
      provider: {
        useFactory: instancePerContainerCachingFactory((container) => {
          const logger = container.resolve<Logger>(SERVICES.LOGGER);
          const config = container.resolve<ConfigType>(SERVICES.CONFIG);
          const metricsRegistry = container.resolve<Registry>(SERVICES.METRICS);
          // TODO: Replace with actual job/stage types once TaskPoller is implemented
          return new JobnikSDK({
            ...config.get('jobnik.sdk'),
            logger,
            metricsRegistry,
          });
        }),
      },
    },
    {
      token: SERVICES.QUEUE_CLIENT,
      provider: {
        useFactory: instancePerContainerCachingFactory((container) => {
          const logger = container.resolve<Logger>(SERVICES.LOGGER);
          const config = container.resolve<ConfigType>(SERVICES.CONFIG);
          const queueConfig = config.get('queue') as QueueConfig;

          return new QueueClient(
            logger,
            queueConfig.jobManagerBaseUrl,
            queueConfig.heartbeatBaseUrl,
            queueConfig.dequeueIntervalMs,
            queueConfig.heartbeatIntervalMs
          );
        }),
      },
    },
    {
      token: SERVICES.WORKER,
      provider: {
        useFactory: instancePerContainerCachingFactory(workerBuilder),
      },
    },
    {
      token: SERVICES.STRATEGY_FACTORY,
      provider: {
        useClass: StrategyFactory,
      },
    },
    {
      token: SERVICES.ERROR_HANDLER,
      provider: {
        useClass: ErrorHandler,
      },
    },
    {
      token: SERVICES.JOB_TRACKER_CLIENT,
      provider: {
        useClass: JobTrackerClient,
      },
    },
    ...(fsStorageConfig ? [{ token: SERVICES.FS_STORAGE_CONFIG, provider: { useValue: fsStorageConfig } }] : []),
    ...(s3StorageConfig ? [{ token: SERVICES.S3_STORAGE_CONFIG, provider: { useValue: s3StorageConfig } }] : []),
    {
      token: SERVICES.STORAGE_PROVIDERS,
      provider: {
        useFactory: instancePerContainerCachingFactory<StorageProviders>((container) => {
          const providers = {
            ...(s3StorageConfig && { [SourceType.S3]: container.resolve(S3StorageProvider) }),
            ...(fsStorageConfig && { [SourceType.FS]: container.resolve(FsStorageProvider) }),
          };
          return providers;
        }),
      },
    },
    {
      token: getJobAndTaskToken({
        //TODO: when we create worker config schema we can move this to a constant and remove the cast
        jobType: configInstance.get('jobDefinitions.jobs.update.type') as unknown as string,
        taskType: configInstance.get('jobDefinitions.tasks.tilesDeletion.type') as unknown as string,
      }),
      provider: {
        useClass: TilesDeletionStrategy,
      },
    },
    {
      token: getJobAndTaskToken({
        //TODO: when we create worker config schema we can move this to a constant and remove the cast
        jobType: configInstance.get('jobDefinitions.jobs.swapUpdate.type') as unknown as string,
        taskType: configInstance.get('jobDefinitions.tasks.tilesDeletion.type') as unknown as string,
      }),
      provider: {
        useClass: TilesDeletionStrategy,
      },
    },
    {
      token: getJobAndTaskToken({
        //TODO: when we create worker config schema we can move this to a constant and remove the cast
        jobType: configInstance.get('jobDefinitions.jobs.deleteLayer.type') as unknown as string,
        taskType: configInstance.get('jobDefinitions.tasks.layerDeletion.type') as unknown as string,
      }),
      provider: {
        useClass: DeleteStoredResourcesStrategy,
      },
    },
    {
      token: getJobAndTaskToken({
        //TODO: when we create worker config schema we can move this to a constant and remove the cast
        jobType: configInstance.get('jobDefinitions.jobs.deleteLayer.type') as unknown as string,
        taskType: configInstance.get('jobDefinitions.tasks.artifactsDeletion.type') as unknown as string,
      }),
      provider: {
        useClass: DeleteStoredResourcesStrategy,
      },
    },
    {
      token: 'onSignal',
      provider: {
        useFactory: (container) => {
          const worker = container.resolve<IWorker>(SERVICES.WORKER);
          return async (): Promise<void> => {
            await Promise.all([getTracing().stop(), worker.stop()]);
          };
        },
      },
    },
  ];

  return Promise.resolve(registerDependencies(dependencies, options?.override, options?.useChild));
};
