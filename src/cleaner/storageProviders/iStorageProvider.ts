export interface IStorageProvider {
  /**
   * Deletes a batch of relative file paths within the given storage target.
   * - S3:  storageTarget = bucket name; paths are object keys
   * - FS:  storageTarget = base directory; full path = join(storageTarget, path)
   *
   * Returns the paths that failed to delete. Treats "not found" as success (idempotent).
   */
  delete: (paths: string[], storageTarget: string) => Promise<string[]>;

  /**
   * Returns true if relativePath exists within storageTarget and contains data.
   * - S3:  storageTarget = bucket, relativePath = key prefix — lists objects (KeyCount > 0)
   * - FS:  storageTarget = base directory, relativePath = subdirectory — checks fs.access
   */
  targetExists: (storageTarget: string, relativePath: string) => Promise<boolean>;
}
