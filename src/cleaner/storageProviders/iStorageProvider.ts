import type { DeleteStoredResourcesParams, Storage } from '@map-colonies/raster-shared';

/**
 * A storage for failures with additional metadata.
 */
export type DeleteFailure = Map<string, { count: number; sample: string }>;

export interface DeleteResult {
  failures: DeleteFailure;
}

export type StorageProvider = Storage['storageProvider'];

export interface IStorageProvider<T extends StorageProvider = StorageProvider> {
  /**
   * Deletes a batch of relative file paths within the given storage target.
   * - S3:  storageTarget = bucket name; paths are object keys
   * - FS:  storageTarget = base directory; full path = join(storageTarget, path)
   *
   * Returns an object including delete failures aggregation with one entry per failed reason.
   * "Not found" is reported as a failure with additional metadata on failure - count and sample
   */
  delete: (paths: string[], storageTarget: string) => Promise<DeleteResult>;

  /**
   * Deletes ALL objects/files under the given paths.
   * - S3:  storageTarget = bucket name; paths are root paths to resource(s)
   * - FS:  storageTarget = base directory; paths are relative paths from mounted dir
   */
  deleteResources: (deleteStoredResourcesParams: Extract<DeleteStoredResourcesParams, { storageProvider: T }>) => Promise<DeleteResult>;

  /**
   * Returns true if relativePath exists within storageTarget and contains data.
   * - S3:  storageTarget = bucket, relativePath = key prefix — lists objects (KeyCount > 0)
   * - FS:  storageTarget = base directory, relativePath = subdirectory — checks fs.access
   */
  targetExists: (storageTarget: string, relativePath: string) => Promise<boolean>;
}

export type StorageProviders = {
  [T in StorageProvider]?: IStorageProvider<T>;
};
