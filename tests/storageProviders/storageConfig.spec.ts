import type { Logger } from '@map-colonies/js-logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { faker } from '@faker-js/faker';
import { ConfigurationError } from '@src/cleaner/errors';
import { buildFsStorageConfig, buildS3StorageConfig, type FsConfig } from '@src/cleaner/storageProviders/storageConfig';
import { assertCanDeleteFromFolder } from '@src/cleaner/utils/fs';
import type { ConfigType } from '@src/common/config';
import {
  createFsStorageConfig,
  createMockFsConfig,
  createMockLogger,
  createMockS3Config,
  createS3StorageConfig,
  FS_STORAGE_CONFIG_DEFAULTS,
} from '../helpers/mocks';

vi.mock('@src/cleaner/utils/fs', () => ({
  assertCanDeleteFromFolder: vi.fn(),
}));

describe('storageConfig', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
  });

  describe('#buildFsStorageConfig', () => {
    let mockConfig: ConfigType;

    beforeEach(() => {
      mockConfig = createMockFsConfig();
    });

    it('should return the validated config', () => {
      const result = buildFsStorageConfig(mockConfig, mockLogger);

      expect(result).toEqual(createFsStorageConfig());
    });

    it('should assert the resolved base path is deletable from', () => {
      buildFsStorageConfig(mockConfig, mockLogger);

      expect(assertCanDeleteFromFolder).toHaveBeenCalledWith(FS_STORAGE_CONFIG_DEFAULTS.basePath, mockLogger);
    });

    it('should flatten every configured subPath into the returned list', () => {
      const config = createMockFsConfig({ subPaths: { tiles: 'artifacts/tiles', gpkg: 'artifacts/gpkg' } satisfies FsConfig['subPaths'] });

      const result = buildFsStorageConfig(config, mockLogger);

      expect(result.subPaths).toEqual(['artifacts/tiles', 'artifacts/gpkg']);
    });

    it('should resolve a relative base path (without a leading separator) to an absolute path', () => {
      const config = createMockFsConfig({ basePath: 'relative/tiles' } satisfies Pick<FsConfig, 'basePath'>);

      const result = buildFsStorageConfig(config, mockLogger);

      expect(result.basePath).toBe('/relative/tiles');
      // the assertion must run against the resolved path, not the raw configured one
      expect(assertCanDeleteFromFolder).toHaveBeenCalledWith('/relative/tiles', mockLogger);
    });

    it('should normalize a base path containing traversal segments before asserting it', () => {
      const config = createMockFsConfig({ basePath: '/test/tiles/../tiles' } satisfies Pick<FsConfig, 'basePath'>);

      const result = buildFsStorageConfig(config, mockLogger);

      expect(result.basePath).toBe('/test/tiles');
      expect(assertCanDeleteFromFolder).toHaveBeenCalledWith('/test/tiles', mockLogger);
    });

    it('should propagate a ConfigurationError raised by the base path assertion', () => {
      const expectedError = new ConfigurationError('FS path does not exist: /test');
      vi.mocked(assertCanDeleteFromFolder).mockImplementation(() => {
        throw expectedError;
      });

      expect(() => buildFsStorageConfig(mockConfig, mockLogger)).toThrow(expectedError);
    });

    it('should throw ConfigurationError when no subPaths are configured', () => {
      const config = createMockFsConfig({ subPaths: {} satisfies FsConfig['subPaths'] });

      expect(() => buildFsStorageConfig(config, mockLogger)).toThrow(ConfigurationError);
    });

    it('should throw ConfigurationError when batchSize is less than or equal to 0', () => {
      const config = createMockFsConfig({ delete: { batchSize: faker.number.int({ max: 0, min: -Number.MAX_SAFE_INTEGER }) } });

      expect(() => buildFsStorageConfig(config, mockLogger)).toThrow(ConfigurationError);
    });
  });

  describe('#buildS3StorageConfig', () => {
    it('should return the validated config', () => {
      const config = createMockS3Config();

      const result = buildS3StorageConfig(config, mockLogger);

      expect(result).toStrictEqual(createS3StorageConfig());
    });

    it('should keep a configured batchSize that is below the S3 max keys limit', () => {
      const config = createMockS3Config({ delete: { batchSize: 250 } });

      const result = buildS3StorageConfig(config, mockLogger);

      expect(result.batchSize).toBe(250);
    });

    it('should clamp a configured batchSize above the S3 max keys limit to 1000', () => {
      const config = createMockS3Config({ delete: { batchSize: 2000 } });

      const result = buildS3StorageConfig(config, mockLogger);

      expect(result.batchSize).toBe(1000);
    });

    it('should keep a configured batchSize that is exactly the S3 max keys limit', () => {
      const config = createMockS3Config({ delete: { batchSize: 1000 } });

      const result = buildS3StorageConfig(config, mockLogger);

      expect(result.batchSize).toBe(1000);
    });

    it('should throw ConfigurationError when batchSize is less than or equal to 0', () => {
      const config = createMockS3Config({ delete: { batchSize: faker.number.int({ max: 0, min: -Number.MAX_SAFE_INTEGER }) } });

      expect(() => buildS3StorageConfig(config, mockLogger)).toThrow(ConfigurationError);
    });
  });
});
