import { StorageProvider, type TileRange, type TilesDeletionParams } from '@map-colonies/raster-shared';
import { generateRedisTileKeys, generateTilePaths } from '../utils';

/**
 * Resolves the tile-key format for a deletion request, bound to its params.
 *
 * Key format belongs to the *key family*, not to the storage API: S3 and FS address a tile
 * identically (`{tilesRelativePath}/{z}/{x}/{y}.{ext}` — mapproxy's layout, not something the
 * S3/FS APIs impose), while Redis uses a flat `{prefix}-{z}-{x}-{y}`. The providers themselves
 * accept arbitrary keys in `delete`, so they have no business formatting them.
 *
 * The `switch` is load-bearing: indexing a `Record<StorageProvider, …>` by
 * `params.storageProvider` collapses the correlated params type back to `never` and forces a
 * cast, whereas switching on the discriminant narrows exactly and stays exhaustiveness-checked
 * when a provider is added.
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
