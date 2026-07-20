/* eslint-disable @typescript-eslint/naming-convention */
import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
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
import { getChunk, normalizeFolderPath } from '@src/cleaner/utils';
import { describeError, UnrecoverableError } from '../errors';

type S3StorageProviderType = Extract<StorageProvider, 'S3'>;

// S3/MinIO reject DeleteObjects requests with more than 1000 keys, regardless of configured batch size.
const S3_DELETE_OBJECTS_MAX_KEYS = 1000;

export interface S3Config {
  delete: {
    batchSize: number;
  };
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  sslEnabled?: boolean;
  forcePathStyle?: boolean;
  region?: string;
}

export class S3StorageProvider implements IStorageProvider<S3StorageProviderType> {
  private readonly s3Client: S3Client;
  private readonly s3Config: S3Config;

  public constructor(
    config: ConfigType,
    private readonly logger: Logger
  ) {
    this.s3Config = config.get('storage.s3') as unknown as S3Config;
    this.s3Client = new S3Client({
      endpoint: this.s3Config.endpoint,
      credentials: {
        accessKeyId: this.s3Config.accessKeyId,
        secretAccessKey: this.s3Config.secretAccessKey,
      },
      forcePathStyle: this.s3Config.forcePathStyle,
      region: this.s3Config.region,
      tls: this.s3Config.sslEnabled,
    });
  }

  public async delete(paths: string[], bucket: string): Promise<DeleteFailure[]> {
    this.logger.debug({ msg: 'Deleting objects from S3', bucket, count: paths.length });

    const failures: DeleteFailure[] = [];

    for (const chunk of getChunk(paths, this.s3Config.delete.batchSize)) {
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

    if (paths.some((path) => path.length === 0)) throw new UnrecoverableError('Cannot delete resources directly under root path of the bucket'); // Prevent root deletion

    const exists = await this.bucketExists(bucket);
    if (!exists) {
      throw new UnrecoverableError(`Bucket does not exist: ${bucket}`);
    }

    for (const path of paths) {
      const pathFailures = await this.deleteResource({ bucket, path });
      failures.push(...pathFailures);
    }

    return { failures };
  }

  public async targetExists(bucket: string, relativePath: string): Promise<boolean> {
    const prefix = normalizeFolderPath(relativePath);
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
    const failures: DeleteFailure[] = [];

    // The configured batch size may exceed the DeleteObjects API limit, so re-chunk defensively here.
    for (const keys of getChunk(paths, S3_DELETE_OBJECTS_MAX_KEYS)) {
      const chunkFailures = await this.deleteObjects(keys, bucket);
      failures.push(...chunkFailures);
    }

    return failures;
  }

  private async deleteObjects(paths: string[], bucket: string): Promise<DeleteFailure[]> {
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
      this.logger.error({ msg: 'S3 batch request failed', bucket, reason, err });
      return paths.map((path) => {
        return { path, reason };
      });
    }
  }

  private async deleteResource({ bucket, path }: { bucket: string; path: string }): Promise<DeleteFailure[]> {
    const failures: DeleteFailure[] = [];
    let totalDeletedObjectsCount = 0,
      totalFailedObjectsCount = 0;

    const s3Objects = this.getS3Objects({
      bucket,
      prefix: path,
      pageSize: this.s3Config.delete.batchSize,
    });

    try {
      for await (const pageOfObjects of s3Objects) {
        this.logger.debug({
          msg: `Received a batch of ${pageOfObjects.length} objects to delete`,
          pageOfObjects,
          path,
          pageSize: this.s3Config.delete.batchSize,
        });
        const keys = pageOfObjects.map((obj) => obj.Key).filter((key): key is string => key !== undefined && this.matchesTarget(key, path));

        if (keys.length === 0) {
          continue;
        }

        const chunkFailures = await this.deleteChunk(keys, bucket);
        failures.push(...chunkFailures);

        const failedObjectsCount = chunkFailures.length;
        const deletedObjectsCount = keys.length - failedObjectsCount;
        totalDeletedObjectsCount += deletedObjectsCount;
        totalFailedObjectsCount += failedObjectsCount;

        this.logger.debug({
          msg: `Successfully deleted ${deletedObjectsCount} objects. Totally ${totalDeletedObjectsCount} successfully deleted objects`,
        });

        if (failedObjectsCount > 0)
          this.logger.debug({
            msg: `Could not delete ${failedObjectsCount} objects. Totally ${totalFailedObjectsCount} objects could not be deleted`,
          });
      }
      this.logger.debug({ msg: 'Deletion completed', path, totalDeletedObjectsCount, totalFailedObjectsCount });
      return failures;
    } catch (err) {
      this.logger.error({
        msg: 'Stream of objects was interrupted by an error',
        path,
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
    pageSize,
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
      // First, if object exists it is removed. This is to mitigate an issue in MinIO that shadows paths sharing common path with an object.
      // Second, objects having this path are iterated and removed
      if (prefix !== undefined && (await this.resourceExists({ bucket, path: prefix }))) {
        yield [{ Key: prefix }];
      }

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
        this.logger.error({ msg: 'Unexpected error occurred during pagination', err, bucket, prefix });
      }
      throw err;
    }
  }

  private async resourceExists({ bucket, path }: { bucket: string; path: string }): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: path }));
      return true;
    } catch (err) {
      if (err instanceof NotFound) {
        return false;
      } else if (err instanceof NoSuchBucket) {
        this.logger.warn({ msg: `S3 Error [${err.name}] no such bucket: ${err.message} (Req ID: ${err.$metadata.requestId})` });
        return false;
      } else {
        this.logger.error({ msg: 'resourceExists object check failed', err, bucket, path });
        throw err;
      }
    }
  }

  // A key belongs to the target if it IS the target object or lives under 'target/'.
  // The 'target/' guard prevents matching sibling keys that merely share the prefix
  // (e.g. target 'photos' must not match 'photos_old/img.jpg', target 'metadata.txt'
  // must not match 'metadata.txt.bak').
  private matchesTarget(key: string, target: string): boolean {
    return key === target || key.startsWith(normalizeFolderPath(target));
  }

  private async bucketExists(bucket: string): Promise<boolean> {
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
      this.logger.error({ msg: 'Failed to check if bucket exists', bucket, reason, err });
      throw err;
    }
  }
}
