import type { Logger } from '@map-colonies/js-logger';
import { deleteStoredResourcesParamsSchema, DeleteStoredResourcesParams, StorageProvider } from '@map-colonies/raster-shared';
import { inject, injectable } from 'tsyringe';
import type { ConfigType } from '@common/config';
import { SERVICES } from '@common/constants';
import { summarizeDeleteFailures, type IStorageProvider, type StorageProviders } from '@src/cleaner/storageProviders';
import { RecoverableError, UnrecoverableError } from '../errors';
import { validateSchema } from '../utils';
import type { ITaskStrategy } from './taskStrategy';

@injectable()
export class DeleteStoredResourcesStrategy implements ITaskStrategy<DeleteStoredResourcesParams> {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.STORAGE_PROVIDERS) private readonly storageProviders: StorageProviders
  ) {}

  public validate(params: unknown): DeleteStoredResourcesParams {
    this.logger.debug({ msg: `Validating input parameters` });
    return validateSchema(deleteStoredResourcesParamsSchema, params, this.logger);
  }

  public async execute(params: DeleteStoredResourcesParams): Promise<void> {
    const paths = params.storageProvider === StorageProvider.REDIS ? [] : params.paths;
    const provider = this.resolveStorageProvider(params.storageProvider);

    this.logger.info({
      msg: 'Starting deletion',
      count: paths.length,
      paths,
      provider: params.storageProvider,
      ...(params.storageProvider === StorageProvider.S3 && { bucket: params.bucket }),
      ...(params.storageProvider === StorageProvider.FS && { subPath: params.subPath }),
      ...(params.storageProvider === StorageProvider.REDIS && { prefix: params.prefix }),
    });

    const { failures } = await provider.deleteResources(params);

    if (failures.size > 0) {
      const { failuresCount, samples, summary } = summarizeDeleteFailures({ failures });
      this.logger.error({
        msg: 'Deletion failed',
        provider: params.storageProvider,
        paths,
        failuresCount,
        summary,
        samples,
      });
      throw new RecoverableError(`Failed to delete ${failuresCount} objects. Reasons: ${summary}. Samples: ${samples.join(', ')}`);
    }

    this.logger.info({
      msg: 'Deletion completed successfully',
      provider: params.storageProvider,
      paths,
    });
  }

  private resolveStorageProvider<K extends StorageProvider>(storageProvider: K): IStorageProvider<K> {
    this.logger.debug({ msg: `Resolving storage provider`, provider: storageProvider, providers: Object.keys(this.storageProviders) });
    const provider = this.storageProviders[storageProvider];
    if (provider === undefined) throw new UnrecoverableError(`Unsupported storage provider ${storageProvider}`);
    this.logger.debug({ msg: `Using ${storageProvider} provider` });
    return provider;
  }
}
