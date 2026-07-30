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
  type _Error,
  type _Object,
} from '@aws-sdk/client-s3';
import type { Logger } from '@map-colonies/js-logger';
import type { DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '@common/constants';
import { mergeFailures, type DeleteFailure, type DeleteResult, type IStorageProvider, type StorageProvider } from '@src/cleaner/storageProviders';
import { getChunk, normalizeFolderPath } from '@src/cleaner/utils';
import { describeError, UnrecoverableError } from '../errors';
import type { S3StorageConfig } from './storageConfig';

type S3StorageProviderType = Extract<StorageProvider, 'S3'>;

@injectable()
export class S3StorageProvider implements IStorageProvider<S3StorageProviderType> {
  private readonly s3Client: S3Client;

  public constructor(
    @inject(SERVICES.S3_STORAGE_CONFIG) private readonly s3Config: S3StorageConfig,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    // TODO: move client to a singleton resolution since
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
    this.logger.debug({ msg: 'Loaded S3 storage provider', endpoint: s3Config.endpoint, batchSize: this.s3Config.batchSize });
  }

  public async delete(paths: string[], bucket: string): Promise<DeleteResult> {
    this.logger.debug({ msg: 'Deleting objects from S3', bucket, pathsCount: paths.length });
    let failures: DeleteFailure = new Map();

    for (const chunk of getChunk(paths, this.s3Config.batchSize)) {
      const chunkFailures = await this.deleteObjects(chunk, bucket);
      failures = mergeFailures({ source: chunkFailures, target: failures });
    }

    return { failures };
  }

  public async deleteResources({
    bucket,
    paths,
  }: Extract<DeleteStoredResourcesParams, { storageProvider: S3StorageProviderType }>): Promise<DeleteResult> {
    this.logger.debug({ msg: `Starting S3 resources deletion`, bucket, pathsCount: paths.length });
    let failures: DeleteFailure = new Map();

    if (paths.length === 0) return { failures };
    if (paths.some((path) => path.length === 0)) throw new UnrecoverableError('Cannot delete resources directly under root path of the bucket'); // Prevent root deletion

    const exists = await this.bucketExists(bucket);
    if (!exists) {
      throw new UnrecoverableError(`Bucket does not exist: ${bucket}`);
    }

    for (const path of paths) {
      const pathFailures = await this.deleteResource({ bucket, path });
      failures = mergeFailures({ source: pathFailures, target: failures });
    }

    return { failures };
  }

  public async targetExists(bucket: string, path: string): Promise<boolean> {
    this.logger.debug({ msg: 'Checking if target resource exists', bucket, path });
    const prefix = normalizeFolderPath(path);
    try {
      const result = await this.s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }));
      return (result.KeyCount ?? 0) > 0;
    } catch (err) {
      if (err instanceof NoSuchBucket) return false;
      this.logger.error({ err, bucket, prefix }, 'targetExists check failed');
      throw err;
    }
  }

  private async bucketExists(bucket: string): Promise<boolean> {
    try {
      this.logger.debug({ msg: 'Checking bucket exists', bucket });
      const command = new HeadBucketCommand({ Bucket: bucket });
      await this.s3Client.send(command); // If it resolves, the bucket exists and you have permission to access it
      this.logger.debug({ msg: 'Bucket exists', bucket });
      return true;
    } catch (err) {
      if (err instanceof NotFound) {
        this.logger.error({ msg: 'Bucket does not exist', bucket, err });
        return false;
      }
      const reason = describeError(err);
      this.logger.error({ msg: 'Failed to check if bucket exists', bucket, reason, err });
      throw err;
    }
  }

  private async deleteObjects(paths: string[], bucket: string): Promise<DeleteFailure> {
    try {
      const command = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: paths.map((Key) => ({ Key })) },
      });

      const response = await this.s3Client.send(command);
      const failures: DeleteFailure = new Map();
      let totalFailuresCount = 0;
      (response.Errors ?? [])
        .filter((error): error is _Error & Required<Pick<_Error, 'Key'>> => error.Key !== undefined) // Only include entries with a Key
        .forEach((error) => {
          const reason = error.Code ?? error.Message ?? 'Unknown';
          const failure = failures.get(reason);
          const failuresCount = (failure?.count ?? 0) + 1;
          totalFailuresCount += failuresCount;
          failures.set(reason, { count: failuresCount, sample: failure?.sample ?? error.Key });
        });

      if (failures.size > 0)
        this.logger.warn({
          msg: 'Failed to delete some objects',
          totalFailuresCount,
          uniqueFailureTypesCount: failures.size,
          failureTypes: Array.from(failures.keys()),
        });
      return failures;
    } catch (err) {
      const reason = describeError(err);
      this.logger.error({ msg: 'S3 delete objects request failed', bucket, reason, err });
      return new Map([[reason, { count: paths.length, sample: paths[0]! }]]);
    }
  }

  private async deleteResource({ bucket, path }: { bucket: string; path: string }): Promise<DeleteFailure> {
    this.logger.debug({ msg: 'Deleting a resource', bucket, path });
    let failures: DeleteFailure = new Map();
    let totalDeletedObjectsCount = 0,
      totalFailedObjectsCount = 0;

    const s3Objects = this.getS3Objects({
      bucket,
      prefix: path,
      pageSize: this.s3Config.batchSize,
    });

    try {
      for await (const pageOfObjects of s3Objects) {
        this.logger.debug({
          msg: 'Received a page of objects to delete',
          bucket,
          path,
          keysSize: pageOfObjects.length,
          pageSize: this.s3Config.batchSize,
          ...(pageOfObjects.length > 0 && { samplePageResponse: pageOfObjects[0] }),
        });
        const keys = pageOfObjects.map((obj) => obj.Key).filter((key): key is string => key !== undefined && this.matchesTarget(key, path));

        if (keys.length === 0) {
          continue;
        }

        const chunkFailures = await this.deleteObjects(keys, bucket);
        failures = mergeFailures({ source: chunkFailures, target: failures });

        let failedObjectsCount = 0;
        chunkFailures.forEach((chunkFailure) => (failedObjectsCount += chunkFailure.count));
        const deletedObjectsCount = keys.length - failedObjectsCount;
        totalDeletedObjectsCount += deletedObjectsCount;
        totalFailedObjectsCount += failedObjectsCount;

        this.logger.debug({
          msg: 'Completed processing current page of objects',
          deletedObjectsCount,
          totalDeletedObjectsCount,
          failedObjectsCount,
          totalFailedObjectsCount,
        });
      }
      this.logger.debug({ msg: 'Resource deletion completed', path, totalDeletedObjectsCount, totalFailedObjectsCount });
      return failures;
    } catch (err) {
      this.logger.error({
        msg: 'Stream of objects for deletion was interrupted by an error',
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
    try {
      this.logger.debug({ msg: 'Starting iteration over matching objects', bucket, prefix, pageSize });
      // First, if object exists it is removed. This is to mitigate an issue in MinIO that shadows paths sharing common path with an object.
      // Second, objects having this path are iterated and removed
      if (prefix !== undefined && (await this.resourceExists({ bucket, path: prefix }))) {
        this.logger.debug({ msg: 'Matched an exact object', bucket, prefix });
        yield [{ Key: prefix }];
      }

      const paginatorConfig = {
        client: this.s3Client,
        pageSize,
      };

      const commandInput = {
        Bucket: bucket,
        Prefix: prefix !== undefined ? normalizeFolderPath(prefix) : prefix,
      };

      let pageNumber = 0;
      const paginator = paginateListObjectsV2(paginatorConfig, commandInput);
      for await (const page of paginator) {
        pageNumber++;
        this.logger.debug({
          msg: 'Got a page of objects',
          bucket,
          prefix,
          pageNumber,
          ...(page.KeyCount !== undefined && { pathsCount: page.KeyCount }),
        });
        yield page.Contents ?? [];
      }
    } catch (err) {
      if (err instanceof NoSuchBucket) {
        this.logger.error({ msg: `S3 Error [${err.name}] no such bucket: ${err.message}`, err });
      } else if (err instanceof S3ServiceException) {
        this.logger.error({ msg: `S3 Error [${err.name}] occured during pagination: ${err.message}`, err });
      } else {
        this.logger.error({ msg: 'Unexpected error occurred during pagination', err, bucket, prefix });
      }
      throw err;
    }
  }

  // A key belongs to the target if it IS the target object or lives under 'target/'.
  // The 'target/' guard prevents matching sibling keys that merely share the prefix
  // (e.g. target 'photos' must not match 'photos_old/img.jpg', target 'metadata.txt'
  // must not match 'metadata.txt.bak').
  private matchesTarget(key: string, target: string): boolean {
    return key === target || key.startsWith(normalizeFolderPath(target));
  }

  private async resourceExists({ bucket, path }: { bucket: string; path: string }): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: path }));
      return true;
    } catch (err) {
      if (err instanceof NotFound) {
        return false;
      } else if (err instanceof NoSuchBucket) {
        this.logger.warn({ msg: `S3 Error [${err.name}] no such bucket: ${err.message}`, err });
        return false;
      } else {
        this.logger.error({ msg: 'resourceExists object check failed', err, bucket, path });
        throw err;
      }
    }
  }
}
