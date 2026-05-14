/**
 * A single failed deletion paired with a short reason string (e.g. 'ENOENT',
 * 'AccessDenied', 'NoSuchKey').
 */
export interface DeleteFailure {
  path: string;
  reason: string;
}

export interface IStorageProvider {
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
   * Returns true if relativePath exists within storageTarget and contains data.
   * - S3:  storageTarget = bucket, relativePath = key prefix — lists objects (KeyCount > 0)
   * - FS:  storageTarget = base directory, relativePath = subdirectory — checks fs.access
   */
  targetExists: (storageTarget: string, relativePath: string) => Promise<boolean>;
}
