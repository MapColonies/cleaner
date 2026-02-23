import type { FactoryFunction } from 'tsyringe';
import type { IWorker } from '@map-colonies/jobnik-sdk';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import type { WorkerCapabilities, JobDefinitions, PollingPairConfig } from '../cleaner/types';
import { buildPollingPairs } from '../cleaner/utils';
import { TaskPoller } from './taskPoller';

const workerBuilder: FactoryFunction<IWorker> = (container) => {
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);

  const jobDefinitions = config.get('jobDefinitions') as JobDefinitions; //TODO:when we create worker config schema we can remove the cast
  const workerCapabilities = config.get('worker.capabilities') as unknown as WorkerCapabilities; //TODO:when we create worker config schema we can remove the cast

  const pollingPairs = buildPollingPairs(jobDefinitions, workerCapabilities);

  container.register<PollingPairConfig[]>(SERVICES.POLLING_PAIRS, { useValue: pollingPairs });

  return container.resolve(TaskPoller);
};

export { workerBuilder };
