import { simpleFaker } from '@faker-js/faker';
import merge from 'deepmerge';
import type { ApiClient, IProducer, Job, JobId, Stage, StageId, Task, TaskId } from '@map-colonies/jobnik-sdk';
import type { PartialDeep } from 'type-fest';
import jsLogger from '@map-colonies/js-logger';
import { vitest } from 'vitest';
import type { LogisticJobTypes, LogisticStageTypes } from '@src/logistics/types';

const LOCATION_LENGTH = 20;
const SIGNATURE_LENGTH = 15;

type HazmatTransportJob = Job<LogisticJobTypes, 'hazmatTransport'>;
type DeliveryStage = Stage<'delivery', LogisticStageTypes['delivery']>;
type DeliveryTask = Task<LogisticStageTypes['delivery']['task']>;

export function createFakeHazmatTransportJob(override: PartialDeep<HazmatTransportJob> = {}): HazmatTransportJob {
  const job: HazmatTransportJob = {
    id: simpleFaker.string.uuid() as JobId,
    name: 'hazmatTransport',
    status: 'IN_PROGRESS',
    creationTime: simpleFaker.date.past().toISOString(),
    data: {
      unNumber: `UN${simpleFaker.number.int({ min: 1000, max: 9999 })}`,
      hazardClass: simpleFaker.helpers.arrayElement(['1', '2.1', '2.2', '3', '4.1', '5.1', '6.1', '8', '9']),
    },
    userMetadata: {
      leaksCount: simpleFaker.number.int({ min: 0, max: 5 }),
      casualtyCount: simpleFaker.number.int({ min: 0, max: 10 }),
    },
    traceparent: simpleFaker.string.uuid(),
  };

  return merge(job, override) as HazmatTransportJob;
}

export function createFakeDeliveryStage(override: PartialDeep<DeliveryStage> = {}): DeliveryStage {
  const stage: DeliveryStage = {
    id: simpleFaker.string.uuid() as StageId,
    type: 'delivery',
    status: 'IN_PROGRESS',
    jobId: simpleFaker.string.uuid() as JobId,
    order: simpleFaker.number.int({ min: 1, max: 10 }),
    summary: {
      pending: 0,
      inProgress: 1,
      completed: 0,
      failed: 0,
      created: 0,
      retried: 0,
      total: 1,
    },
    data: {
      location: simpleFaker.string.alphanumeric(LOCATION_LENGTH),
      timeWindowStart: simpleFaker.date.future().toISOString(),
      timeWindowEnd: simpleFaker.date.future().toISOString(),
    },
    userMetadata: {
      signaturedBy: simpleFaker.string.alphanumeric(SIGNATURE_LENGTH),
    },
    traceparent: simpleFaker.string.uuid(),
  };
  return merge(stage, override) as DeliveryStage;
}

export function createFakePickupTask(override: PartialDeep<DeliveryTask> = {}): DeliveryTask {
  const task: DeliveryTask = {
    attempts: 0,
    creationTime: simpleFaker.date.past().toISOString(),
    id: simpleFaker.string.uuid() as TaskId,
    stageId: simpleFaker.string.uuid() as StageId,
    data: {
      quantity: simpleFaker.number.int({ min: 1, max: 100 }),
      itemId: simpleFaker.string.uuid(),
    },
    status: 'IN_PROGRESS',
    maxAttempts: 3,
    traceparent: simpleFaker.string.uuid(),
  };
  return merge(task, override) as DeliveryTask;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createFakeTaskHandlerContext<J extends Job, S extends Stage>(job: J, stage: S) {
  return {
    apiClient: {} as ApiClient,
    logger: jsLogger({ enabled: false }),
    job,
    stage,
    producer: {} as IProducer<LogisticJobTypes, LogisticStageTypes>,
    signal: new AbortController().signal,
    updateStageUserMetadata: vitest.fn(),
    updateJobUserMetadata: vitest.fn(),
    updateTaskUserMetadata: vitest.fn(),
  };
}

export function createFakeJobTaskChain(
  jobOverride?: PartialDeep<HazmatTransportJob>,
  stageOverride?: PartialDeep<DeliveryStage>,
  taskOverride?: PartialDeep<DeliveryTask>
): {
  job: HazmatTransportJob;
  stage: DeliveryStage;
  task: DeliveryTask;
} {
  const job = createFakeHazmatTransportJob(jobOverride);
  const stage = createFakeDeliveryStage(stageOverride);
  const task = createFakePickupTask(taskOverride);

  return {
    job,
    stage,
    task,
  };
}
