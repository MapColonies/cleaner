import type { Logger } from '@map-colonies/js-logger';
import { deleteStoredResourcesParamsSchema, type DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
import { inject, injectable } from 'tsyringe';
import type { ConfigType } from '@common/config';
import { SERVICES } from '@common/constants';
import { summarizeDeleteFailures, type IStorageProvider, type StorageProvider, type StorageProviders } from '@src/cleaner/storageProviders';
import { RecoverableError, UnrecoverableError } from '../errors';
import { validateSchema } from '../utils';
import type { ITaskStrategy } from './taskStrategy';

@injectable()
export class DeleteStoredResourcesStrategy implements ITaskStrategy<DeleteStoredResourcesParams> {
  private readonly failureSampleSize: number;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.STORAGE_PROVIDERS) private readonly storageProviders: StorageProviders
  ) {
    this.failureSampleSize = this.config.get('strategies.storedResourcesDeletion.failureSampleSize') as unknown as number;
  }

  public validate(params: unknown): DeleteStoredResourcesParams {
    this.logger.debug({ msg: `Validating input parameters` });
    return validateSchema(deleteStoredResourcesParamsSchema, params, this.logger);
  }

  public async execute(params: DeleteStoredResourcesParams): Promise<void> {
    const { paths } = params;
    const provider = this.resolveStorageProvider(params);

    this.logger.info({ msg: 'Starting deletion', provider: params.storageProvider, paths });

    const { failures } = await provider.deleteResources(params);

    if (failures.length > 0) {
      const { counts, summary, sample } = summarizeDeleteFailures(failures, this.failureSampleSize);
      this.logger.error({
        msg: 'Deletion failed',
        provider: params.storageProvider,
        paths,
        failureCount: failures.length,
        reasonCounts: counts,
        sample,
      });
      throw new RecoverableError(`Failed to delete resource(s). Reasons: ${summary}. Sample: ${sample.join(', ')}`);
    }

    this.logger.info({
      msg: 'Deletion completed successfully',
      provider: params.storageProvider,
      paths,
    });
  }

  private resolveStorageProvider<K extends StorageProvider>(
    params: Extract<DeleteStoredResourcesParams, { storageProvider: K }>
  ): IStorageProvider<K> {
    if (!(params.storageProvider in this.storageProviders)) throw new UnrecoverableError(`Unsupported storage provider ${params.storageProvider}`);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const storageProvider = this.storageProviders[params.storageProvider];
    if (storageProvider === undefined) throw new UnrecoverableError(`Unsupported storage provider ${params.storageProvider}`);
    this.logger.debug({ msg: `Using ${params.storageProvider} provider` });
    return storageProvider;
  }
}
