import { faker } from '@faker-js/faker';
import { OperationStatus, type ITaskResponse } from '@map-colonies/mc-priority-queue';

export function buildTask(overrides: Partial<ITaskResponse<unknown>> = {}): ITaskResponse<unknown> {
  return {
    id: faker.string.uuid(),
    jobId: faker.string.uuid(),
    type: 'tiles-deletion',
    description: faker.lorem.sentence(),
    parameters: {},
    created: faker.date.past().toISOString(),
    updated: faker.date.recent().toISOString(),
    status: OperationStatus.IN_PROGRESS,
    reason: '',
    attempts: 1,
    resettable: true,
    ...overrides,
  };
}
