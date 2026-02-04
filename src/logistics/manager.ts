// import { setTimeout as sleep } from 'node:timers/promises';
import type { Task, TaskHandlerContext } from '@map-colonies/jobnik-sdk';
import { injectable } from 'tsyringe';
import type { LogisticJobTypes, LogisticStageTypes } from './types';

async function pickupPackage(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  const randomDelay = Math.floor(Math.random() * 120000);
  await new Promise((resolve) => setTimeout(resolve, randomDelay));
}

@injectable()
export class LogisticsManager {
  public async handleDeliveryTask(
    task: Task<LogisticStageTypes['delivery']['task']>,
    context: TaskHandlerContext<LogisticJobTypes, LogisticStageTypes, 'hazmatTransport', 'delivery'>
  ): Promise<void> {
    context.logger.info({ msg: 'Handling pickup task for quantity:', quantity: task.data.quantity });
    const casualtyCount = context.job.userMetadata?.casualtyCount ?? 0;
    if (casualtyCount > task.data.quantity) {
      throw new Error('Casualty count exceeds quantity to be picked up');
    }

    await pickupPackage();

    await context.updateStageUserMetadata({ signaturedBy: 'John Doe' });
  }
}
