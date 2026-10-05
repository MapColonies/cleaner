import { S3Client } from '@aws-sdk/client-s3';
import type { S3StorageConfig } from '../storageProviders/storageConfig';

/**
 * Builds the S3 client shared by every resolution of the S3 storage provider.
 * Its sockets are released by the `onSignal` shutdown hook.
 */
export function createS3Client(config: S3StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
    region: config.region,
    tls: config.sslEnabled,
  });
}
