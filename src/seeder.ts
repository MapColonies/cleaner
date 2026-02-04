// THIS FILE IS FOR DEMONSTRATION PURPOSES ONLY. IT SHOWS HOW TO USE THE PRODUCER TO SEED DATA INTO THE JOBNIK SYSTEM.
// REMOVE THIS FILE IN PRODUCTION.
import { IProducer } from '@map-colonies/jobnik-sdk';
import { LogisticJobTypes, LogisticStageTypes } from './logistics/types';

export async function seedData(producer: IProducer<LogisticJobTypes, LogisticStageTypes>): Promise<void> {
  const job = await producer.createJob<'hazmatTransport'>({
    name: 'Hazmat Transport Job',
    priority: 'HIGH',
    data: { unNumber: 'UN1993', hazardClass: '3' },
    userMetadata: { leaksCount: 0, casualtyCount: 2 },
  });

  const stage = await producer.createStage<'delivery'>(job.id, {
    type: 'delivery',
    data: {
      location: 'Warehouse 42',
      timeWindowStart: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      timeWindowEnd: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
    userMetadata: { signaturedBy: '' },
  });

  await producer.createTasks<'delivery'>(stage.id, 'delivery', [
    {
      data: { itemId: 'ITEM123', quantity: 5 },
    },
    {
      data: { itemId: 'ITEM456', quantity: 3 },
    },
  ]);
}
