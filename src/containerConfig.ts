import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { Registry } from 'prom-client';
import { instancePerContainerCachingFactory } from 'tsyringe';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { Logger } from '@map-colonies/js-logger';
import { IWorker, JobnikSDK } from '@map-colonies/jobnik-sdk';
import { InjectionObject, registerDependencies } from '@common/dependencyRegistration';
import { SERVICES, SERVICE_NAME } from '@common/constants';
import { getTracing } from '@common/tracing';
import { ConfigType, getConfig } from './common/config';
import { workerBuilder } from './worker';
import { StrategyFactory } from './cleaner/strategies';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const configInstance = getConfig();

  const loggerConfig = configInstance.get('telemetry.logger');

  const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });

  const tracer = trace.getTracer(SERVICE_NAME);
  const metricsRegistry = new Registry();
  configInstance.initializeMetrics(metricsRegistry);

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
