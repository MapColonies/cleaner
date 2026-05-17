import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { HttpClient, type IHttpRetryConfig } from '@map-colonies/mc-utils';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';

/**
 * Notifies job-tracker that a task reached a terminal state (Completed or Failed).
 */
@injectable()
export class JobTrackerClient extends HttpClient {
  public constructor(
    @inject(SERVICES.LOGGER) protected override readonly logger: Logger,
    @inject(SERVICES.CONFIG) config: ConfigType
  ) {
    const baseUrl = config.get('servicesUrl.jobTracker') as unknown as string;
    const httpRetryConfig = config.get('httpRetry') as IHttpRetryConfig;
    const disableHttpClientLogs = config.get('disableHttpClientLogs') as boolean;
    super(logger, baseUrl, 'JobTracker', httpRetryConfig, disableHttpClientLogs);
  }

  public async notify(taskId: string): Promise<void> {
    try {
      await this.post(`tasks/${taskId}/notify`);
    } catch (error) {
      this.logger.error({ msg: 'Failed to notify job tracker', taskId, error });
    }
  }
}
