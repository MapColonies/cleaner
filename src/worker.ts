import type { IWorker } from '@map-colonies/jobnik-sdk';
import type { FactoryFunction } from 'tsyringe';

/**
 * Worker factory function.
 * TODO: Implement worker creation once TaskPoller is implemented.
 * For now, this is a stub to satisfy the containerConfig registration.
 */
export const workerBuilder: FactoryFunction<IWorker> = () => {
  // TODO: Replace with actual worker implementation
  // When TaskPoller is ready, this will create and configure the worker
  // For the skeleton, we return a minimal stub
  throw new Error('Worker not implemented - TaskPoller integration pending');
};
