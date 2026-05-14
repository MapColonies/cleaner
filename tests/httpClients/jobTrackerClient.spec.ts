import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Logger } from '@map-colonies/js-logger';
import { faker } from '@faker-js/faker';
import { JobTrackerClient } from '@src/cleaner/httpClients/jobTrackerClient';
import type { ConfigType } from '@src/common/config';
import { createMockLogger } from '../helpers/mocks';

const mockPost = vi.fn();

vi.mock('@map-colonies/mc-utils', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  HttpClient: class {
    public post = mockPost;
  },
}));

const JOB_TRACKER_URL = 'http://job-tracker.test';

function buildConfig(): ConfigType {
  const values: Record<string, unknown> = {
    'servicesUrl.jobTracker': JOB_TRACKER_URL,
    httpRetry: { attempts: 3, delay: 'exponential', shouldResetTimeout: true },
    disableHttpClientLogs: false,
  };
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigType;
}

describe('JobTrackerClient', () => {
  let client: JobTrackerClient;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue(undefined);
    logger = createMockLogger();
    client = new JobTrackerClient(logger, buildConfig());
  });

  it('POSTs to /tasks/{taskId}/notify', async () => {
    await client.notify('abc-123');

    expect(mockPost).toHaveBeenCalledWith('tasks/abc-123/notify');
  });

  it('resolves without throwing on a failed notification (fire-and-forget)', async () => {
    mockPost.mockRejectedValue(new Error('500 Internal Server Error'));

    await expect(client.notify('abc-123')).resolves.toBeUndefined();
  });

  it('logs the error and does not rethrow when notification fails', async () => {
    const failure = new Error('500 Internal Server Error');
    const taskId = faker.string.uuid();
    mockPost.mockRejectedValue(failure);

    await expect(client.notify(taskId)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ msg: 'Failed to notify job tracker', taskId, error: failure }));
  });

  it('encodes each call with its own taskId', async () => {
    const [firstId, secondId] = [faker.string.uuid(), faker.string.uuid()];
    await client.notify(firstId);
    await client.notify(secondId);

    expect(mockPost).toHaveBeenNthCalledWith(1, `tasks/${firstId}/notify`);
    expect(mockPost).toHaveBeenNthCalledWith(2, `tasks/${secondId}/notify`);
  });
});
