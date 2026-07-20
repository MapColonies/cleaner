import { accessSync, constants, statSync } from 'node:fs';
import { rm, rmdir, stat, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import type { DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
import type { DeleteFailure, DeleteResourcesResult, IStorageProvider, StorageProvider } from '@src/cleaner/storageProviders';
import { getChunk, normalizeFolderPath } from '@src/cleaner/utils';
import type { ConfigType } from '@src/common/config';
import { ConfigurationError, describeError, UnrecoverableError } from '../errors';

type FSStorageProviderType = Extract<StorageProvider, 'FS'>;

export interface FsConfig {
  delete: {
    batchSize: number;
  };
  basePath: string;
}

export class FsStorageProvider implements IStorageProvider<'FS'> {
  private readonly fsConfig: FsConfig;
  private readonly basePath: string;

  public constructor(
    private readonly config: ConfigType,
    private readonly logger: Logger
  ) {
    this.fsConfig = this.config.get('storage.fs') as unknown as FsConfig;
    this.basePath = this.resolveAbsolutePath(this.fsConfig.basePath);
    this.canDeleteFromFolder(this.basePath);
    this.logger.debug(`Using ${this.basePath} as base path for FS`);
  }

  public async targetExists(storageTarget: string, relativePath: string): Promise<boolean> {
    try {
      await stat(join(storageTarget, relativePath));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  public async delete(paths: string[], storageTarget: string): Promise<DeleteFailure[]> {
    this.logger.info({ msg: 'Deleting files from filesystem', basePath: storageTarget, count: paths.length });

    const failures: DeleteFailure[] = [];
    for (const relativePaths of getChunk(paths, this.fsConfig.delete.batchSize)) {
      const results = await Promise.allSettled(
        relativePaths.map(async (relativePath) => {
          await unlink(join(storageTarget, relativePath));
        })
      );

      for (const [idx, result] of results.entries()) {
        if (result.status === 'rejected') {
          const relativePath = relativePaths[idx]!;
          const error: unknown = result.reason;
          const reason = describeError(error);
          this.logger.debug({ msg: 'Failed to delete file', path: join(storageTarget, relativePath), reason, error });
          failures.push({ path: relativePath, reason });
        }
      }
    }

    await this.cleanupEmptyDirs(paths, storageTarget);

    return failures;
  }

  public async deleteResources({
    paths,
  }: Extract<DeleteStoredResourcesParams, { storageProvider: FSStorageProviderType }>): Promise<DeleteResourcesResult> {
    // prevent path traversal (i.e. accessing folders above root folder)
    if (!this.checkPathTraversal(paths)) throw new UnrecoverableError(`Cannot delete files/folders outside base path or base path itself`);
    if (!paths.every((path) => this.resolveAbsolutePath(join(this.basePath, path)) !== this.basePath))
      throw new UnrecoverableError(`Cannot delete base path itself`);

    const failures: DeleteFailure[] = [];
    for (const relativePaths of getChunk(paths, this.fsConfig.delete.batchSize)) {
      const results = await Promise.allSettled(
        relativePaths.map(async (relativePath) => {
          await rm(join(this.basePath, relativePath), { recursive: true, force: true });
        })
      );

      for (const [idx, result] of results.entries()) {
        if (result.status === 'rejected') {
          const fullPath = join(this.basePath, relativePaths[idx]!);
          const reason = describeError(result.reason);
          this.logger.error({ msg: 'Failed to delete layer directory', fullPath, reason, err: result.reason });
          failures.push({ path: fullPath, reason });
        }
      }
    }

    return { failures };
  }

  private canDeleteFromFolder(path: string): void {
    try {
      accessSync(path, constants.F_OK | constants.R_OK | constants.W_OK);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        throw new ConfigurationError(`FS path does not exist: ${path}`);
      } else if (err instanceof Error && 'code' in err && (err.code === 'EACCES' || err.code === 'EPERM')) {
        throw new ConfigurationError(`FS path permission denied for path: ${path}`);
      } else {
        throw new ConfigurationError(`An unexpected error occurred on FS path accessibility check: ${describeError(err)}`);
      }
    }

    try {
      const pathStat = statSync(path);
      if (!pathStat.isDirectory()) {
        throw new ConfigurationError(`FS path exists but it is a file, not a directory: ${path}`);
      }
    } catch (err) {
      throw new ConfigurationError(`An unexpected error occurred on FS info check: ${describeError(err)}`);
    }
  }

  private checkPathTraversal(paths: string[]): boolean {
    return paths.every((path) => {
      const absolutePath = this.resolveAbsolutePath(join(this.basePath, path));
      return absolutePath.startsWith(normalizeFolderPath(this.basePath));
    });
  }

  // Attempts to remove any directories that became empty after file deletion.
  // Strategy: collect every ancestor directory of every deleted file, grouped by
  // depth relative to the file (levelIdx 0 = direct parent, 1 = grandparent, …).
  // Delete deepest dirs first so that once a directory is empty its parent can
  // also be removed in a subsequent level. rmdir silently fails on non-empty dirs,
  // so any directory still containing files is simply skipped.
  //
  // Example — deleting layer/v1/5/0/0.png and layer/v1/5/0/1.png collects:
  //   levelIdx 0 → { storageTarget/layer/v1/5/0 }   (direct parent, tried first)
  //   levelIdx 1 → { storageTarget/layer/v1/5 }
  //   levelIdx 2 → { storageTarget/layer/v1 }
  //   levelIdx 3 → { storageTarget/layer }            (root ancestor, tried last)
  private async cleanupEmptyDirs(relativePaths: string[], storageTarget: string): Promise<void> {
    // Map from levelIdx → unique absolute dir paths at that depth.
    // Using a Set per level deduplicates dirs shared by multiple deleted files
    // (e.g. a shared parent directory when multiple files within it are deleted at once).
    const dirsByLevel = new Map<number, Set<string>>();

    for (const relativePath of relativePaths) {
      const parts = relativePath.split('/');
      const segments = parts.slice(0, parts.length - 1); // strip filename, keep dir segments
      for (let count = segments.length; count >= 1; count--) {
        // levelIdx 0 is the innermost dir (direct parent of the tile file);
        // higher values walk toward the storage root.
        const levelIdx = segments.length - count;
        if (!dirsByLevel.has(levelIdx)) {
          dirsByLevel.set(levelIdx, new Set());
        }
        dirsByLevel.get(levelIdx)!.add(join(storageTarget, segments.slice(0, count).join('/')));
      }
    }

    // Sort ascending so innermost dirs are attempted before their ancestors.
    // This ordering is required: a parent directory can only be removed after its
    // children have already been deleted.
    const sortedLevels = [...dirsByLevel.keys()].sort((a, b) => a - b);
    for (const level of sortedLevels) {
      const dirs = dirsByLevel.get(level)!;
      // allSettled — rmdir rejects on non-empty dirs; we intentionally ignore those errors.
      await Promise.allSettled([...dirs].map(async (dir) => rmdir(dir)));
    }
  }

  /**
   * Resolves a file system path to an absolute path.
   * Ensures the path is resolved as an absolute path and properly formatted
   * with a leading separator if not already present.
   * @param path - The input path string to normalize
   * @returns An absolute path with proper path separators
   */
  private resolveAbsolutePath(path: string): string {
    return resolve(`${path.startsWith(sep) ? '' : sep}${path}`);
  }
}
