import type { Logger } from '@map-colonies/js-logger';
import { assertCanDeleteFromFolder, resolveAbsolutePath } from '@src/cleaner/utils';
import type { ConfigType } from '@src/common/config';
import { ConfigurationError } from '../errors';

// S3/MinIO reject DeleteObjects requests with more than 1000 keys, regardless of configured batch size.
const S3_DELETE_OBJECTS_MAX_KEYS = 1000;

export interface FsConfig {
  delete: {
    batchSize: number;
  };
  basePath: string;
  subPaths: Record<string, string>;
}

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

export interface FsStorageConfig {
  basePath: string;
  subPaths: string[];
  batchSize: number;
}

export interface S3StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  sslEnabled?: boolean;
  forcePathStyle?: boolean;
  region?: string;
  batchSize: number;
}

/**
 * Reads and validates `storage.fs`.
 * @returns {FsStorageConfig} FS configuration for FsStorageProvider
 * @throws {ConfigurationError} if the config is unusable or the base path is not a writable directory
 */
export function buildFsStorageConfig(config: ConfigType, logger: Logger): FsStorageConfig {
  //TODO: when we create a worker config schema the shape checks below can be dropped along with the cast
  const fsConfig = config.get('storage.fs') as unknown as FsConfig;

  const {
    delete: { batchSize: deleteBatchSize },
    ...fsStorageConfig
  } = fsConfig;

  const subPaths = Object.values(fsStorageConfig.subPaths);
  if (subPaths.length === 0) throw new ConfigurationError('Deletion subpaths must have at least 1 entry');
  if (deleteBatchSize <= 0) throw new ConfigurationError('Deletion batch size must be greater than 0');

  const basePath = resolveAbsolutePath(fsStorageConfig.basePath);
  assertCanDeleteFromFolder(basePath, logger);

  logger.info({ msg: 'Validated FS storage config', basePath, subPaths, batchSize: deleteBatchSize });
  return { basePath, subPaths, batchSize: deleteBatchSize };
}

/**
 * Reads and validates `storage.s3`.
 * @returns {S3StorageConfig} S3 configuration for S3StorageProvider
 * @throws {ConfigurationError} if the config is unusable
 */
export function buildS3StorageConfig(config: ConfigType, logger: Logger): S3StorageConfig {
  //TODO: when we create a worker config schema the shape check below can be dropped along with the cast
  const s3Config = config.get('storage.s3') as unknown as S3Config;

  const {
    delete: { batchSize: deleteBatchSize },
    ...s3StorageConfig
  } = s3Config;

  if (deleteBatchSize <= 0) throw new ConfigurationError('Deletion batch size must be greater than 0');
  const batchSize = Math.min(deleteBatchSize, S3_DELETE_OBJECTS_MAX_KEYS);

  logger.debug({ msg: 'Validated S3 storage config', endpoint: s3StorageConfig.endpoint, batchSize });
  return {
    ...s3StorageConfig,
    batchSize,
  };
}
