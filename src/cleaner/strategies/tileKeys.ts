import { StorageProvider, type TileRange, type TilesDeletionParams } from '@map-colonies/raster-shared';
import { generateRedisTileKeys, generateTilePaths } from '../utils';

/**
 * Picks the tile-key format for a deletion request. Switching on the discriminant (rather than
 * indexing a `Record<StorageProvider, …>`) is what narrows `params` per provider without a cast.
 */
export function resolveTileKeyGenerator(params: TilesDeletionParams): (range: TileRange) => Generator<string> {
  switch (params.storageProvider) {
    case StorageProvider.S3:
    case StorageProvider.FS:
      return (range) => generateTilePaths(range, params.tilesRelativePath, params.fileExtension);
    case StorageProvider.REDIS:
      return (range) => generateRedisTileKeys(range, params.prefix);
  }
}
