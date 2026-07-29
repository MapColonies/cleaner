import { accessSync, constants, statSync } from 'node:fs';
import { rm, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import type { DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
import { mergeFailures, type DeleteFailure, type DeleteResult, type IStorageProvider, type StorageProvider } from '@src/cleaner/storageProviders';
import { getChunk, normalizeFolderPath, resolveAbsolutePath } from '@src/cleaner/utils';
import type { ConfigType } from '@src/common/config';
import { ConfigurationError, describeError, UnrecoverableError } from '../errors';

type FSStorageProviderType = Extract<StorageProvider, 'FS'>;

export interface FsConfig {
  delete: {
    batchSize: number;
  };
  basePath: string;
  subPaths: Record<string, string>;
}

export class FsStorageProvider implements IStorageProvider<'FS'> {
  private readonly fsConfig: FsConfig;
  private readonly basePath: string;
  private readonly subPaths: string[];

  public constructor(
    private readonly config: ConfigType,
    private readonly logger: Logger
  ) {
    this.fsConfig = this.config.get('storage.fs') as unknown as FsConfig;
    this.subPaths = Object.values(this.fsConfig.subPaths);
    if (this.subPaths.length === 0) throw new ConfigurationError('subPaths must have at least 1 entry');
    if (this.fsConfig.delete.batchSize <= 0) throw new ConfigurationError('Deletion batch size must be greater than 0');
    this.basePath = resolveAbsolutePath(this.fsConfig.basePath);
    this.canDeleteFromFolder(this.basePath);
    this.logger.debug({ msg: 'Loaded FS storage provider', basePath: this.basePath });
  }

  public async targetExists(basePath: string, relativePath: string): Promise<boolean> {
    this.logger.debug({ msg: 'Checking if target resource exists', basePath, path: relativePath });
    try {
      await stat(join(basePath, relativePath));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  public async delete(paths: string[], basePath: string): Promise<DeleteResult> {
    this.logger.debug({ msg: 'Deleting files from filesystem', basePath, pathsCount: paths.length });
    let failures: DeleteFailure = new Map();

    for (const relativePaths of getChunk(paths, this.fsConfig.delete.batchSize)) {
      const results = await Promise.allSettled(
        relativePaths.map(async (relativePath) => {
          await unlink(join(basePath, relativePath));
        })
      );

      const chunkFailures: DeleteFailure = new Map();
      for (const [idx, result] of results.entries()) {
        if (result.status === 'rejected') {
          const relativePath = relativePaths[idx]!;
          const error: unknown = result.reason;
          const reason = describeError(error);
          this.logger.debug({ msg: 'Failed to delete file', path: join(basePath, relativePath), reason, error });
          const chunkFailure = chunkFailures.get(reason);
          chunkFailures.set(reason, { count: (chunkFailure?.count ?? 0) + 1, sample: chunkFailure?.sample ?? relativePaths[idx]! });
        }
      }
      failures = mergeFailures({ source: chunkFailures, target: failures });
    }

    await this.cleanupEmptyDirs(paths, basePath);

    return { failures };
  }

  public async deleteResources({
    paths,
    subPath,
  }: Extract<DeleteStoredResourcesParams, { storageProvider: FSStorageProviderType }>): Promise<DeleteResult> {
    this.logger.debug({ msg: 'Starting FS files/dirs deletion', subPath, pathsCount: paths.length });
    let totalDeletedPathsCount = 0,
      totalFailedPathsCount = 0;

    const relativePaths = paths.map((path) => join(subPath, path));

    if (!this.arePathsValid(relativePaths))
      throw new UnrecoverableError(
        'Cannot delete files/folders outside base path or subpath as well as base path or subpath itself. paths must also match a valid configured path.'
      );

    let failures: DeleteFailure = new Map();

    for (const relativePathsChunk of getChunk(relativePaths, this.fsConfig.delete.batchSize)) {
      const results = await Promise.allSettled(
        relativePathsChunk.map(async (relativePath) => {
          await rm(join(this.basePath, relativePath), { recursive: true, force: true });
        })
      );

      const chunkFailures: DeleteFailure = new Map();
      for (const [idx, result] of results.entries()) {
        if (result.status === 'rejected') {
          const fullPath = join(this.basePath, relativePathsChunk[idx]!);
          const reason = describeError(result.reason);
          this.logger.error({ msg: 'Failed to delete file/folder', fullPath, reason, err: result.reason });
          const chunkFailure = chunkFailures.get(reason);
          chunkFailures.set(reason, { count: (chunkFailure?.count ?? 0) + 1, sample: chunkFailure?.sample ?? fullPath });
        }
      }
      failures = mergeFailures({ source: chunkFailures, target: failures });

      let failedPathsCount = 0;
      chunkFailures.forEach((chunkFailure) => (failedPathsCount += chunkFailure.count));
      const deletedPathsCount = relativePathsChunk.length - failedPathsCount;
      totalDeletedPathsCount += deletedPathsCount;
      totalFailedPathsCount += failedPathsCount;
      this.logger.debug({
        msg: 'Completed processing current chunk of paths',
        deletedPathsCount,
        totalDeletedPathsCount,
        failedPathsCount,
        totalFailedPathsCount,
      });
    }

    return { failures };
  }

  private canDeleteFromFolder(path: string): void {
    try {
      accessSync(path, constants.F_OK | constants.R_OK | constants.W_OK);
      this.logger.debug({ msg: 'Able to delete from directory', path });
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
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`An unexpected error occurred on FS info check: ${describeError(err)}`);
    }
  }

  /**
   * Preforms several checks on input `paths`.
   * Includes a check for path traversal (i.e. accessing folders above root folder)
   * @param paths
   * @returns boolean whether `paths` are valid and pass all checks
   */
  private arePathsValid(paths: string[]): boolean {
    this.logger.debug({ msg: 'Checking paths validity', paths });
    const badPaths = paths.filter((path) => {
      const startsWithAllowedSubPath = this.subPaths.some((subPath) => path.startsWith(normalizeFolderPath(subPath)));
      const absolutePath = resolveAbsolutePath(join(this.basePath, path));
      const startsWithBasePath = absolutePath.startsWith(normalizeFolderPath(this.basePath));
      return !(startsWithAllowedSubPath && startsWithBasePath);
    });
    const areValid = badPaths.length === 0;
    this.logger.debug({ msg: `Paths validity check ${areValid ? 'succeeded' : 'failed'}`, ...(!areValid && { badPaths }) });
    return areValid;
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
    this.logger.debug({ msg: 'Deleting empty directories', pathsCount: relativePaths.length });
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
}
