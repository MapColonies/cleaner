import type { IWorker } from '@map-colonies/jobnik-sdk';
import type { Logger } from '@map-colonies/js-logger';
import type { DependencyContainer, FactoryFunction } from 'tsyringe';
import { SERVICES } from './common/constants';
import { LogisticsManager } from './logistics/manager';
import { LogisticsSDK } from './logistics/types';
import { ConfigType } from './common/config';

export const workerBuilder: FactoryFunction<IWorker> = (container: DependencyContainer) => {
  const sdk = container.resolve<LogisticsSDK>(SERVICES.JOBNIK_SDK);
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);

  const logisticsManager = container.resolve(LogisticsManager);

  const worker = sdk.createWorker<'hazmatTransport', 'delivery'>(
    'delivery',
    logisticsManager.handleDeliveryTask.bind(logisticsManager),
    config.get('jobnik.worker')
  );

  worker.on('error', (err) => {
    logger.error({ msg: 'Worker encountered an error:', err });
  });

  return worker;
};
