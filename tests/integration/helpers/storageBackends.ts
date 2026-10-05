import { join } from 'node:path';
import { StorageProvider } from '@map-colonies/raster-shared';
import type { StorageProviders } from '@src/cleaner/storageProviders';
import type { BackendHandles, TestStorageContext } from './backendFixtures';
import { listAllFiles, writeManyTiles } from './fsTestKit';
import { listAllKeys, putManyTiles } from './s3TestKit';
import { listAllKeys as listAllRedisKeys, seedKeys } from './redisTestKit';

const DEFAULT_TILE_EXTENSION = 'png';

/**
 * Raw access to one real storage backend, independent of any strategy: what a test seeds
 * before a task runs and reads back afterwards. Strategy suites layer their own task-shaped
 * vocabulary on top of this.
 */
interface StorageBackend {
  storageProvider: StorageProvider;
  /**
   * Names one tile of `layer` the way this backend stores it, relative to the storage target —
   * exactly as the strategies generate the keys they hand the provider.
   */
  tileKey: (layer: string, zoom: number, x: number, y: number, extension?: string) => string;
  /** Seeds tiles at keys relative to the storage target. */
  seed: (keys: string[]) => Promise<void>;
  /** Sorted keys under the storage target, narrowed to those starting with `prefix` when given. */
  list: (prefix?: string) => Promise<string[]>;
}

/** A task the strategy or provider must refuse as a producer bug rather than retry. */
interface SadPath<Params> {
  params: () => Params;
  /** Replaces the context's providers, e.g. to leave this backend unregistered. */
  providers?: (storageContext: TestStorageContext) => StorageProviders;
  /** Substring of the rejection reason. */
  reason: string;
}

/** `{layer}/{z}/{x}/{y}.{ext}` — the S3 object key and the FS path under the sub path. */
const pathTileKey: StorageBackend['tileKey'] = (layer, zoom, x, y, extension = DEFAULT_TILE_EXTENSION) => `${layer}/${zoom}/${x}/${y}.${extension}`;

/** `{prefix}-{z}-{x}-{y}` — the mapproxy cache key, no extension. */
const redisTileKey: StorageBackend['tileKey'] = (prefix, zoom, x, y) => `${prefix}-${zoom}-${x}-${y}`;

/** The context's providers minus `storageProvider`, so a task addressed to it is unsupported. */
function providersWithout(storageProvider: StorageProvider): (storageContext: TestStorageContext) => StorageProviders {
  return ({ providers }) => {
    const rest = { ...providers };
    delete rest[storageProvider];
    return rest;
  };
}

/** The providers a sad-path task should run against: its own override, else the context's. */
function sadPathProviders({ providers }: SadPath<unknown>, storageContext: TestStorageContext): StorageProviders {
  return providers ? providers(storageContext) : storageContext.providers;
}

function s3StorageBackend(handles: () => BackendHandles, perTest: () => TestStorageContext): StorageBackend {
  return {
    storageProvider: StorageProvider.S3,
    tileKey: pathTileKey,
    seed: async (keys) => putManyTiles(handles().s3Client, perTest().bucket, keys),
    list: async (prefix) => listAllKeys(handles().s3Client, perTest().bucket, prefix),
  };
}

function fsStorageBackend(perTest: () => TestStorageContext): StorageBackend {
  // The provider joins base path + sub path itself, so the test seeds and reads the same root.
  const targetRoot = (): string => join(perTest().fsBasePath, perTest().fsSubPath);
  return {
    storageProvider: StorageProvider.FS,
    tileKey: pathTileKey,
    seed: async (keys) => writeManyTiles(targetRoot(), keys),
    list: async (prefix = '') => (await listAllFiles(targetRoot())).filter((path) => path.startsWith(prefix)),
  };
}

function redisStorageBackend(handles: () => BackendHandles): StorageBackend {
  return {
    storageProvider: StorageProvider.REDIS,
    tileKey: redisTileKey,
    seed: async (keys) => seedKeys(handles().redisClient, keys),
    list: async (prefix = '') => (await listAllRedisKeys(handles().redisClient)).filter((key) => key.startsWith(prefix)),
  };
}

export { s3StorageBackend, fsStorageBackend, redisStorageBackend, providersWithout, sadPathProviders };
export type { StorageBackend, SadPath };
