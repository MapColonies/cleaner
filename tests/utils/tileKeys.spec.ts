import { faker } from '@faker-js/faker';
import type { FsTilesDeletionParams, RedisTilesDeletionParams, S3TilesDeletionParams, TileRange } from '@map-colonies/raster-shared';
import { describe, expect, it } from 'vitest';
import { resolveTileKeyGenerator } from '@src/cleaner/utils/tileKeys';

const RANGE: TileRange = { zoom: 3, minX: 1, maxX: 2, minY: 5, maxY: 6 };

/**
 * Pins the key shape per storage provider. S3 and FS must stay byte-identical — the strategy
 * relies on them sharing one key family — while Redis uses mapproxy's flat key format.
 */
describe('resolveTileKeyGenerator', () => {
  const relativePath = `${faker.string.uuid()}/${faker.string.uuid()}`;

  describe('S3', () => {
    it('should yield a path per tile, ordered x-major then y', () => {
      const params: S3TilesDeletionParams = {
        storageProvider: 'S3',
        bucket: 'b',
        tilesRelativePath: relativePath,
        fileExtension: 'png',
        ranges: [RANGE],
      };

      expect([...resolveTileKeyGenerator(params)(RANGE)]).toEqual([
        `${relativePath}/3/1/5.png`,
        `${relativePath}/3/1/6.png`,
        `${relativePath}/3/2/5.png`,
        `${relativePath}/3/2/6.png`,
      ]);
    });

    it('should use the requested file extension', () => {
      const range: TileRange = { zoom: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
      const params: S3TilesDeletionParams = {
        storageProvider: 'S3',
        bucket: 'b',
        tilesRelativePath: relativePath,
        fileExtension: 'jpeg',
        ranges: [range],
      };

      expect([...resolveTileKeyGenerator(params)(range)]).toEqual([`${relativePath}/0/0/0.jpeg`]);
    });
  });

  describe('FS', () => {
    it('should yield the same path shape as S3', () => {
      const fsParams: FsTilesDeletionParams = {
        storageProvider: 'FS',
        subPath: 'artifacts/tiles',
        tilesRelativePath: relativePath,
        fileExtension: 'jpeg',
        ranges: [RANGE],
      };
      const s3Params: S3TilesDeletionParams = {
        storageProvider: 'S3',
        bucket: 'b',
        tilesRelativePath: relativePath,
        fileExtension: 'jpeg',
        ranges: [RANGE],
      };

      expect([...resolveTileKeyGenerator(fsParams)(RANGE)]).toEqual([...resolveTileKeyGenerator(s3Params)(RANGE)]);
    });

    it('should offset x and y when the range does not start at zero', () => {
      const range: TileRange = { zoom: 7, minX: 3, maxX: 4, minY: 8, maxY: 9 };
      const params: FsTilesDeletionParams = {
        storageProvider: 'FS',
        subPath: 'artifacts/tiles',
        tilesRelativePath: relativePath,
        fileExtension: 'png',
        ranges: [range],
      };

      expect([...resolveTileKeyGenerator(params)(range)]).toEqual([
        `${relativePath}/7/3/8.png`,
        `${relativePath}/7/3/9.png`,
        `${relativePath}/7/4/8.png`,
        `${relativePath}/7/4/9.png`,
      ]);
    });
  });

  describe('REDIS', () => {
    it('should yield flat prefixed keys rather than paths', () => {
      const prefix = 'myLayer-redis_WorldCRS84';
      const params: RedisTilesDeletionParams = {
        storageProvider: 'REDIS',
        prefix,
        ranges: [RANGE],
      };

      expect([...resolveTileKeyGenerator(params)(RANGE)]).toEqual([`${prefix}-3-1-5`, `${prefix}-3-1-6`, `${prefix}-3-2-5`, `${prefix}-3-2-6`]);
    });
  });
});
