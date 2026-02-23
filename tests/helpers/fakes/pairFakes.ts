import { faker } from '@faker-js/faker';
import type { PollingPairConfig } from '@src/cleaner/types';

export function buildPair(overrides: Partial<PollingPairConfig> = {}): PollingPairConfig {
  return {
    jobType: faker.word.noun(),
    taskType: faker.word.noun(),
    maxAttempts: faker.number.int({ min: 2, max: 10 }),
    ...overrides,
  };
}
