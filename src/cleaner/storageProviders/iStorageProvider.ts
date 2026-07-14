import type { DeleteStoredResourcesParams } from '@map-colonies/raster-shared';

/**
 * A single failed deletion paired with a short reason string (e.g. 'ENOENT',
 * 'AccessDenied', 'NoSuchKey').
 */
export interface DeleteFailure {
  path: string;
  reason: string;
}

export interface DeleteResourcesResult {
  failures: DeleteFailure[];
}

export type StorageProvider = DeleteStoredResourcesParams['storageProvider'];

export interface IStorageProvider<T extends StorageProvider = StorageProvider> {
  /**
   * Deletes a batch of relative file paths within the given storage target.
   * - S3:  storageTarget = bucket name; paths are object keys
   * - FS:  storageTarget = base directory; full path = join(storageTarget, path)
   *
   * Returns one entry per failed deletion. "Not found" is reported as a failure
   * (with reason 'ENOENT' / 'NoSuchKey').
   */
  delete: (paths: string[], storageTarget: string) => Promise<DeleteFailure[]>;

  /**
   * Deletes ALL objects/files under the given paths.
   * - S3:  storageTarget = bucket name; paths are root paths to resource(s)
   * - FS:  storageTarget = base directory; paths are relative paths from mounted dir
   */
  deleteResources: (deleteStoredResourcesParams: Extract<DeleteStoredResourcesParams, { storageProvider: T }>) => Promise<DeleteResourcesResult>;

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
