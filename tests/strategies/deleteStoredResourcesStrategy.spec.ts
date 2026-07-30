import type { Logger } from '@map-colonies/js-logger';
import { SourceType, type DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
import { beforeEach, describe, expect, it, type vi } from 'vitest';
import { RecoverableError, UnrecoverableError, ValidationError } from '@src/cleaner/errors';
import type { IStorageProvider, StorageProviders } from '@src/cleaner/storageProviders';
import { DeleteStoredResourcesStrategy } from '@src/cleaner/strategies/deleteStoredResourcesStrategy';
import type { ConfigType } from '@src/common/config';
import { createMockStoredResourcesDeletionStrategyConfig, createMockLogger, createMockStorageProvider } from '../helpers/mocks';

const S3_BUCKET = 'test-bucket';
const FS_SUB_PATH = 'test/artifacts/tiles';

const s3Params: DeleteStoredResourcesParams = { storageProvider: SourceType.S3, paths: ['layer1'], bucket: S3_BUCKET };
const fsParams: DeleteStoredResourcesParams = { storageProvider: SourceType.FS, paths: ['layer2'], subPath: FS_SUB_PATH };

describe('DeleteStoredResourcesStrategy', () => {
  let strategy: DeleteStoredResourcesStrategy;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  let mockS3Provider: IStorageProvider<'S3'>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  let mockFsProvider: IStorageProvider<'FS'>;
  let mockLogger: Logger;
  let mockConfig: ConfigType;

  beforeEach(() => {
    mockS3Provider = createMockStorageProvider();
    mockFsProvider = createMockStorageProvider();
    mockLogger = createMockLogger();
    mockConfig = createMockStoredResourcesDeletionStrategyConfig();

    const storageProviders: StorageProviders = {
      [SourceType.FS]: mockFsProvider,
      [SourceType.S3]: mockS3Provider,
    };

    strategy = new DeleteStoredResourcesStrategy(mockLogger, mockConfig, storageProviders);
  });

  describe('#validate', () => {
    it('should validate and return S3 params', () => {
      const result = strategy.validate(s3Params);

      expect(result).toEqual(s3Params);
    });

    it('should validate and return FS params', () => {
      const result = strategy.validate(fsParams);

      expect(result).toEqual(fsParams);
    });

    it('should throw ValidationError when storageProvider is missing', () => {
      expect(() => strategy.validate({ catalogId: 'layer1' })).toThrow(ValidationError);
    });

    it('should throw ValidationError when storageProvider is unknown', () => {
      expect(() => strategy.validate({ storageProvider: 'GCS', catalogId: 'layer1' })).toThrow(ValidationError);
    });

    it('should throw ValidationError when tilesPath is empty string', () => {
      expect(() => strategy.validate({ storageProvider: SourceType.S3, catalogId: '' })).toThrow(ValidationError);
    });

    it('should throw ValidationError when tilesPath is missing', () => {
      expect(() => strategy.validate({ storageProvider: SourceType.S3 })).toThrow(ValidationError);
    });

    it('should throw ValidationError for null params', () => {
      expect(() => strategy.validate(null)).toThrow(ValidationError);
    });
  });

  describe('#execute', () => {
    it('should call delete all resources on S3 provider', async () => {
      await strategy.execute(s3Params);

      expect(mockS3Provider.deleteResources).toHaveBeenCalledWith({ paths: s3Params.paths, bucket: S3_BUCKET, storageProvider: 'S3' });
      expect(mockFsProvider.deleteResources).not.toHaveBeenCalled();
    });

    it('should call delete all resources on FS provider', async () => {
      await strategy.execute(fsParams);

      expect(mockFsProvider.deleteResources).toHaveBeenCalledWith({ paths: fsParams.paths, subPath: FS_SUB_PATH, storageProvider: 'FS' });
      expect(mockS3Provider.deleteResources).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when deleteResources returns no failures', async () => {
      (mockS3Provider.deleteResources as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ failures: [] });

      const result = strategy.execute(s3Params);

      await expect(result).resolves.toBeUndefined();
    });

    it('should throw UnrecoverableError for unknown provider', async () => {
      const unknownParams = { ...s3Params, storageProvider: 'UNKNOWN' } as unknown as DeleteStoredResourcesParams;

      const result = strategy.execute(unknownParams);

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(mockS3Provider.deleteResources).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError when the provider is registered but resolves to undefined', async () => {
      const storageProviders = {
        [SourceType.FS]: mockFsProvider,
        [SourceType.S3]: undefined,
      } as unknown as StorageProviders;
      strategy = new DeleteStoredResourcesStrategy(mockLogger, mockConfig, storageProviders);

      const result = strategy.execute(s3Params);

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(mockS3Provider.deleteResources).not.toHaveBeenCalled();
    });

    it('should throw RecoverableError when deleteResources returns failures', async () => {
      (mockS3Provider.deleteResources as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        failures: new Map([['AccessDenied', { count: 1, sample: 'layer1/0/0.png' }]]),
      });

      const result = strategy.execute(s3Params);

      await expect(result).rejects.toThrow(RecoverableError);
    });

    it('should include the failures count, grouped reasons and samples in the RecoverableError message', async () => {
      (mockS3Provider.deleteResources as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        failures: new Map([
          ['AccessDenied', { count: 1, sample: 'layer1/0/0.png' }],
          ['InternalError', { count: 4, sample: 'layer1/0/1.png' }],
        ]),
      });

      // reasons and samples are ordered by descending count
      await expect(strategy.execute(s3Params)).rejects.toThrow(
        'Failed to delete 5 objects. Reasons: InternalError=4, AccessDenied=1. Samples: layer1/0/1.png (InternalError), layer1/0/0.png (AccessDenied)'
      );
    });

    it('should pass every path through to the provider', async () => {
      const params: DeleteStoredResourcesParams = { ...s3Params, paths: ['layer1', 'layer2', 'layer3'] };

      await strategy.execute(params);

      expect(mockS3Provider.deleteResources).toHaveBeenCalledWith({ paths: params.paths, bucket: S3_BUCKET, storageProvider: 'S3' });
    });

    it('should resolve without throwing for an empty paths list', async () => {
      const result = strategy.execute({ ...s3Params, paths: [] });

      await expect(result).resolves.toBeUndefined();
      expect(mockS3Provider.deleteResources).toHaveBeenCalledWith({ paths: [], bucket: S3_BUCKET, storageProvider: 'S3' });
    });

    it('should rethrow error thrown by deleteResources', async () => {
      const expectedError = new Error('Custom');
      (mockS3Provider.deleteResources as ReturnType<typeof vi.fn>).mockRejectedValueOnce(expectedError);

      const result = strategy.execute(s3Params);

      await expect(result).rejects.toThrow(expectedError);
    });
  });
});
