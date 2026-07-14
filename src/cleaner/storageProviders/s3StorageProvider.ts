/* eslint-disable @typescript-eslint/naming-convention */
import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchBucket,
  NotFound,
  paginateListObjectsV2,
  S3Client,
  S3ServiceException,
  type _Object,
} from '@aws-sdk/client-s3';
import type { Logger } from '@map-colonies/js-logger';
import type { DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
import type { ConfigType } from '@common/config';
import type { DeleteFailure, DeleteResourcesResult, IStorageProvider, StorageProvider } from '@src/cleaner/storageProviders';
import { describeError, UnrecoverableError } from '../errors';
import { getChunk } from '../utils';

const S3_MAX_DELETE_BATCH = 1000;

type S3StorageProviderType = Extract<StorageProvider, 'S3'>;

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  sslEnabled?: boolean;
  forcePathStyle?: boolean;
  region?: string;
}

export class S3StorageProvider implements IStorageProvider<S3StorageProviderType> {
  private readonly s3Client: S3Client;

  public constructor(
    config: ConfigType,
    private readonly logger: Logger
  ) {
    const s3Config = config.get('storage.s3') as unknown as S3Config;
    this.s3Client = new S3Client({
      endpoint: s3Config.endpoint,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      forcePathStyle: s3Config.forcePathStyle,
      region: s3Config.region,
      tls: s3Config.sslEnabled,
    });
  }

  public async delete(paths: string[], bucket: string): Promise<DeleteFailure[]> {
    this.logger.debug({ msg: 'Deleting objects from S3', bucket, count: paths.length });

    const failures: DeleteFailure[] = [];

    for (const chunk of getChunk(paths, S3_MAX_DELETE_BATCH)) {
      const failed = await this.deleteChunk(chunk, bucket);
      failures.push(...failed);
    }

    return failures;
  }

  public async deleteResources({
    bucket,
    paths,
  }: Extract<DeleteStoredResourcesParams, { storageProvider: S3StorageProviderType }>): Promise<DeleteResourcesResult> {
    const failures: DeleteFailure[] = [];
    this.logger.debug({ msg: `Starting S3 deletion`, bucket, paths });

    const exists = await this.storageExists(bucket);
    if (!exists) {
      throw new UnrecoverableError(`Bucket does not exist: ${bucket}`);
    }

    if (paths.some((path) => path.length === 0)) throw new UnrecoverableError('Cannot delete resources directly under root path of the bucket'); // Prevent root deletion

    for (const path of paths) {
      const pathFailures = await this.deleteResource({ bucket, path });
      failures.push(...pathFailures);
    }

    return { failures };
  }

  public async targetExists(bucket: string, relativePath: string): Promise<boolean> {
    const prefix = this.normalizePrefix(relativePath);
    try {
      const result = await this.s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }));
      return (result.KeyCount ?? 0) > 0;
    } catch (err) {
      if (err instanceof NoSuchBucket) return false;
      this.logger.error({ err, bucket, prefix }, 'targetExists check failed');
      throw err;
    }
  }

  private async deleteChunk(paths: string[], bucket: string): Promise<DeleteFailure[]> {
    try {
      const command = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: paths.map((Key) => ({ Key })) },
      });

      const response = await this.s3Client.send(command);
      const errors = (response.Errors ?? [])
        .filter((error): error is typeof error & { Key: string } => Boolean(error.Key)) // Only include entries with a Key so every failure maps to a specific path.
        .map((error) => ({ path: error.Key, reason: error.Code ?? error.Message ?? 'Unknown' }));
      if (errors.length > 0) this.logger.warn({ msg: `Failed to delete ${errors.length} out of ${paths.length} objects` });
      return errors;
    } catch (err) {
      const reason = describeError(err);
      this.logger.error({ msg: 'S3 batch request failed', bucket, reason, error: err });
      return paths.map((path) => {
        return { path, reason };
      });
    }
  }

  private async deleteResource({ bucket, path }: { path: string; bucket: string }): Promise<DeleteFailure[]> {
    const failures: DeleteFailure[] = [];
    const normalizedPrefix = this.normalizePrefix(path);
    let totalDeletedObjectsCount = 0,
      totalFailedObjectsCount = 0;

    this.logger.debug({ msg: 'Deleting all objects from S3 under given path', bucket, prefix: normalizedPrefix });

    const s3Objects = this.getS3Objects({
      bucket,
      prefix: normalizedPrefix,
    });

    try {
      for await (const pageOfObjects of s3Objects) {
        this.logger.debug(`Received a batch of ${pageOfObjects.length} objects to delete`);
        const keys = pageOfObjects.map((obj) => obj.Key!).filter(Boolean);

        const chunkFailures = await this.deleteChunk(keys, bucket);
        failures.push(...chunkFailures);

        const failedObjectsCount = chunkFailures.length;
        const deletedObjectsCount = keys.length - failedObjectsCount;
        totalDeletedObjectsCount += deletedObjectsCount;
        totalFailedObjectsCount += failedObjectsCount;

        this.logger.debug({
          msg: `Successfully deleted ${deletedObjectsCount} out of total of ${totalDeletedObjectsCount} successfully deleted objects`,
        });

        if (failedObjectsCount > 0)
          this.logger.debug({
            msg: `Could not delete ${failedObjectsCount} objects out of total of ${totalFailedObjectsCount} objects that could not be deleted`,
          });
      }
      this.logger.debug({ msg: 'Deletion completed', prefix: normalizedPrefix, totalDeletedObjectsCount, totalFailedObjectsCount });
      return failures;
    } catch (err) {
      this.logger.error({
        msg: 'Stream of objects was interrupted by an error',
        prefix: normalizedPrefix,
        totalDeletedObjectsCount,
        totalFailedObjectsCount,
        err,
      });
      throw err;
    }
  }

  private async *getS3Objects({
    bucket,
    prefix,
    pageSize = S3_MAX_DELETE_BATCH,
  }: {
    bucket: string;
    prefix?: string;
    pageSize?: number;
  }): AsyncGenerator<_Object[], void, unknown> {
    const paginatorConfig = {
      client: this.s3Client,
      pageSize,
    };

    const commandInput = {
      Bucket: bucket,
      Prefix: prefix,
    };

    try {
      const paginator = paginateListObjectsV2(paginatorConfig, commandInput);

      for await (const page of paginator) {
        yield page.Contents ?? [];
      }
    } catch (err) {
      if (err instanceof NoSuchBucket) {
        this.logger.error({ msg: `S3 Error [${err.name}] no such bucket: ${err.message} (Req ID: ${err.$metadata.requestId})` });
      } else if (err instanceof S3ServiceException) {
        this.logger.error({ msg: `S3 Error [${err.name}] occured during pagination: ${err.message} (Req ID: ${err.$metadata.requestId})` });
      } else {
        this.logger.error({ msg: 'Unexpected error occurred during pagination', err });
      }
      throw err;
    }
  }

  private normalizePrefix(path: string): string {
    return path.endsWith('/') ? path : `${path}/`; // Ensure prefix ends with '/' so the target is a "folder" contents (e.g. 'photos/' matches 'photos/img.jpg' not 'photos_old/...')
  }

  private async storageExists(bucket: string): Promise<boolean> {
    try {
      this.logger.debug({ msg: `Checking bucket exists`, bucket });
      const command = new HeadBucketCommand({ Bucket: bucket });
      await this.s3Client.send(command); // If it resolves, the bucket exists and you have permission to access it
      this.logger.debug({ msg: `Bucket exists`, bucket });
      return true;
    } catch (err) {
      if (err instanceof NotFound) {
        this.logger.error({ msg: `Bucket does not exist`, bucket, err });
        return false;
      }
      const reason = describeError(err);
      this.logger.error({ msg: 'Failed to check if bucket exists', bucket, reason, error: err });
      throw err;
    }
  }
}
