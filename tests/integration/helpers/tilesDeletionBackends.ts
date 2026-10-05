import { faker } from '@faker-js/faker';
import { StorageProvider, type TileRange, type TilesDeletionParams } from '@map-colonies/raster-shared';
import { buildFsTilesDeletionParams, buildRedisTilesDeletionParams, buildS3TilesDeletionParams } from '../../helpers/fakes/tilesDeletionFakes';
import type { ProviderBatchSizes, StorageBackendsHarness } from './backendFixtures';
import { fsStorageBackend, providersWithout, redisStorageBackend, s3StorageBackend, type SadPath, type StorageBackend } from './storageBackends';
import type { TileKeyFormat } from './tileFixtures';

type ParamsOf<P extends StorageProvider> = Extract<TilesDeletionParams, { storageProvider: P }>;
type PathParams = ParamsOf<'S3' | 'FS'>;

/**
 * Adapts one storage backend to the range-shaped vocabulary of the tiles-deletion E2E suite.
 * Params-typed members are method signatures (bivariant) rather than function properties, so a
 * `TilesDeletionBackend<S3 params>` still fits the `describe.each` list typed on the whole union.
 */
/* eslint-disable @typescript-eslint/method-signature-style */
interface TilesDeletionBackend<Params extends TilesDeletionParams = TilesDeletionParams> extends StorageBackend {
  /** Batch sizes that make this backend's provider re-chunk a strategy batch of `chunkSize`. */
  chunkedBatchSizes: (chunkSize: number) => ProviderBatchSizes;
  sadPath: SadPath<TilesDeletionParams>;
  /**
   * Task params carrying a fresh locator for this backend — bucket + relative path for S3,
   * sub path + relative path for FS, key prefix for Redis. `overrides` pins the otherwise-faked
   * tile fields, e.g. explicit `ranges`.
   */
  buildParams(overrides?: { ranges?: TileRange[] }): Params;
  /** Names one tile of `params` the way this backend stores it — what `seed` and `list` speak. */
  keyFormat(params: Params): TileKeyFormat;
  /** Surviving tiles under the locator of `params`. */
  listTarget(params: Params): Promise<string[]>;
}
/* eslint-enable @typescript-eslint/method-signature-style */

const freshRelativePath = (): string => `${faker.string.uuid()}/${faker.string.uuid()}`;

/**
 * S3 and FS both address tiles as `{tilesRelativePath}/{z}/{x}/{y}.{ext}` under their locator
 * and both probe the target before deleting, so they differ only in how params are built and
 * whether the provider re-chunks a batch.
 */
function pathTilesBackend<Params extends PathParams>(
  storage: StorageBackend,
  buildParams: TilesDeletionBackend<Params>['buildParams'],
  chunkedBatchSizes: TilesDeletionBackend['chunkedBatchSizes']
): TilesDeletionBackend<Params> {
  return {
    ...storage,
    buildParams,
    keyFormat: (params) => (zoom, x, y) => storage.tileKey(params.tilesRelativePath, zoom, x, y, params.fileExtension),
    listTarget: async (params) => storage.list(`${params.tilesRelativePath}/`),
    chunkedBatchSizes,
    // Nothing is seeded, so the path the task points at was never created on the backend.
    sadPath: { params: buildParams, reason: 'storage target does not exist' },
  };
}

function s3TilesBackend({ handles, storageContext }: StorageBackendsHarness): TilesDeletionBackend<ParamsOf<'S3'>> {
  return pathTilesBackend(
    s3StorageBackend(handles, storageContext),
    (overrides) => buildS3TilesDeletionParams({ ...overrides, bucket: storageContext().bucket, tilesRelativePath: freshRelativePath() }),
    (chunkSize) => ({ s3: chunkSize })
  );
}

function fsTilesBackend({ storageContext }: StorageBackendsHarness): TilesDeletionBackend<ParamsOf<'FS'>> {
  return pathTilesBackend(
    fsStorageBackend(storageContext),
    (overrides) => buildFsTilesDeletionParams({ ...overrides, subPath: storageContext().fsSubPath, tilesRelativePath: freshRelativePath() }),
    // `delete` fans every path out at once, so no FS batch size re-chunks a strategy batch.
    () => ({})
  );
}

function redisTilesBackend({ handles }: StorageBackendsHarness): TilesDeletionBackend<ParamsOf<'REDIS'>> {
  const storage = redisStorageBackend(handles);
  return {
    ...storage,
    buildParams: (overrides) => buildRedisTilesDeletionParams(overrides),
    keyFormat: (params) => (zoom, x, y) => storage.tileKey(params.prefix, zoom, x, y),
    listTarget: async (params) => storage.list(`${params.prefix}-`),
    chunkedBatchSizes: (chunkSize) => ({ redis: chunkSize }),
    // Redis has no target to probe — a cold prefix is a clean no-op — so the only unrecoverable
    // path is a task addressed to a provider this instance was not configured with.
    sadPath: {
      params: () => buildRedisTilesDeletionParams(),
      providers: providersWithout(StorageProvider.REDIS),
      reason: 'Unsupported storage provider REDIS',
    },
  };
}

/** One adapter per real backend, for `describe.each`. */
function tilesDeletionBackends(harness: StorageBackendsHarness): TilesDeletionBackend[] {
  return [s3TilesBackend(harness), fsTilesBackend(harness), redisTilesBackend(harness)];
}

export { tilesDeletionBackends };
export type { TilesDeletionBackend };
