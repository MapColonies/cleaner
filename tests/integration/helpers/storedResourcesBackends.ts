import { StorageProvider, type DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
import type { StorageBackendsHarness } from './backendFixtures';
import { fsStorageBackend, providersWithout, redisStorageBackend, s3StorageBackend, type SadPath, type StorageBackend } from './storageBackends';

/** Adapts one storage backend to the layer-shaped vocabulary of the stored-resources E2E suite. */
interface ResourceBackend extends StorageBackend {
  /** Every path/prefix travels in the task params; each backend names its own locator. */
  buildParams: (layers: string[]) => DeleteStoredResourcesParams;
  /** Redis wipes exactly one prefix per task, so multi-layer scenarios skip it. */
  supportsMultipleLayers: boolean;
  sadPath: SadPath<DeleteStoredResourcesParams>;
}

function s3ResourceBackend({ handles, storageContext }: StorageBackendsHarness): ResourceBackend {
  return {
    ...s3StorageBackend(handles, storageContext),
    buildParams: (layers) => ({ storageProvider: StorageProvider.S3, bucket: storageContext().bucket, paths: layers }),
    supportsMultipleLayers: true,
    sadPath: {
      params: () => ({ storageProvider: StorageProvider.S3, bucket: 'no-such-bucket', paths: ['layer'] }),
      reason: 'Bucket does not exist',
    },
  };
}

function fsResourceBackend({ storageContext }: StorageBackendsHarness): ResourceBackend {
  return {
    ...fsStorageBackend(storageContext),
    buildParams: (layers) => ({ storageProvider: StorageProvider.FS, subPath: storageContext().fsSubPath, paths: layers }),
    supportsMultipleLayers: true,
    sadPath: {
      // Climbs out of the allowed sub path, which the FS provider refuses outright
      params: () => ({ storageProvider: StorageProvider.FS, subPath: storageContext().fsSubPath, paths: ['../../escaped'] }),
      reason: 'Cannot delete paths outside the configured sub paths',
    },
  };
}

function redisResourceBackend({ handles }: StorageBackendsHarness): ResourceBackend {
  return {
    ...redisStorageBackend(handles),
    buildParams: ([prefix]) => ({ storageProvider: StorageProvider.REDIS, prefix: prefix! }),
    supportsMultipleLayers: false,
    sadPath: {
      params: () => ({ storageProvider: StorageProvider.REDIS, prefix: 'layer' }),
      providers: providersWithout(StorageProvider.REDIS),
      reason: 'Unsupported storage provider REDIS',
    },
  };
}

/** One adapter per real backend, for `describe.each`. */
function storedResourcesBackends(harness: StorageBackendsHarness): ResourceBackend[] {
  return [s3ResourceBackend(harness), fsResourceBackend(harness), redisResourceBackend(harness)];
}

export { storedResourcesBackends };
export type { ResourceBackend };
