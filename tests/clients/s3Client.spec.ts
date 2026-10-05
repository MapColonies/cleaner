/* eslint-disable @typescript-eslint/naming-convention */
import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createS3Client } from '@src/cleaner/clients/s3Client';
import { createS3StorageConfig, S3_VALIDATED_CONFIG_DEFAULTS } from '../helpers/mocks';

vi.mock(import('@aws-sdk/client-s3'), async (importOriginal) => {
  const originModule = await importOriginal();
  return { ...originModule, S3Client: vi.fn() as unknown as typeof S3Client };
});

describe('createS3Client', () => {
  it('should construct S3Client with config values', () => {
    createS3Client(createS3StorageConfig());

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessKeyId: S3_VALIDATED_CONFIG_DEFAULTS.accessKeyId,
          secretAccessKey: S3_VALIDATED_CONFIG_DEFAULTS.secretAccessKey,
        },
        endpoint: S3_VALIDATED_CONFIG_DEFAULTS.endpoint,
        forcePathStyle: S3_VALIDATED_CONFIG_DEFAULTS.forcePathStyle,
        region: S3_VALIDATED_CONFIG_DEFAULTS.region,
        tls: S3_VALIDATED_CONFIG_DEFAULTS.sslEnabled,
      })
    );
  });
});
