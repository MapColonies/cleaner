import { rm, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import type { DeleteStoredResourcesParams } from '@map-colonies/raster-shared';
import { inject, injectable } from 'tsyringe';
import { mergeFailures, type DeleteFailure, type DeleteResult, type IStorageProvider, type StorageProvider } from '@src/cleaner/storageProviders';
import { getChunk, isPathWithinAllowedSubPaths } from '@src/cleaner/utils';
import { SERVICES } from '@common/constants';
import { describeError, UnrecoverableError } from '../errors';
import type { FsStorageConfig } from './storageConfig';

type FSStorageProviderType = Extract<StorageProvider, 'FS'>;

@injectable()
export class FsStorageProvider implements IStorageProvider<'FS'> {
  public constructor(
    @inject(SERVICES.FS_STORAGE_CONFIG) private readonly fsConfig: FsStorageConfig,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.logger.debug({ msg: 'Loaded FS storage provider', basePath: this.fsConfig.basePath });
  }

  /**
   * @param subPath - Sub path of the configured base path, as supplied by the task
   * @param relativePath - Path below `subPath` to check for
   */
  public async targetExists(subPath: string, relativePath: string): Promise<boolean> {
    this.assertPathsValid([join(subPath, relativePath)]);

    const targetPath = join(this.fsConfig.basePath, subPath, relativePath);
    this.logger.debug({ msg: 'Checking if target resource exists', subPath, path: relativePath, targetPath });
    try {
      await stat(targetPath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /**
   * @param paths - Paths relative to `subPath`
   * @param subPath - Sub path of the configured base path, as supplied by the task
   */
  public async delete(paths: string[], subPath: string): Promise<DeleteResult> {
    this.logger.debug({ msg: 'Deleting files from filesystem', subPath, pathsCount: paths.length });
    const targetPath = join(this.fsConfig.basePath, subPath);
    let failures: DeleteFailure = new Map();

    const results = await Promise.allSettled(
      paths.map(async (relativePath) => {
        await unlink(join(targetPath, relativePath));
      })
    );

    const chunkFailures: DeleteFailure = new Map();
    for (const [idx, result] of results.entries()) {
      if (result.status === 'rejected') {
        const relativePath = paths[idx]!;
        const error: unknown = result.reason;
        const reason = describeError(error);
        this.logger.debug({ msg: 'Failed to delete file', path: join(targetPath, relativePath), reason, error });
        const chunkFailure = chunkFailures.get(reason);
        chunkFailures.set(reason, { count: (chunkFailure?.count ?? 0) + 1, sample: chunkFailure?.sample ?? relativePath });
      }
    }
    failures = mergeFailures({ source: chunkFailures, target: failures });

    await this.cleanupEmptyDirs(paths, targetPath);

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
    this.assertPathsValid(relativePaths);

    let failures: DeleteFailure = new Map();

    for (const relativePathsChunk of getChunk(relativePaths, this.fsConfig.batchSize)) {
      const results = await Promise.allSettled(
        relativePathsChunk.map(async (relativePath) => {
          await rm(join(this.fsConfig.basePath, relativePath), { recursive: true, force: true });
        })
      );

      const chunkFailures: DeleteFailure = new Map();
      for (const [idx, result] of results.entries()) {
        if (result.status === 'rejected') {
          const fullPath = join(this.fsConfig.basePath, relativePathsChunk[idx]!);
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

  /**
   * Gate for every path this provider is asked to touch.
   * @param relativePaths - Paths relative to the configured base path, sub path included
   * @throws {UnrecoverableError} if any path fails the check; invalid paths are a producer
   * bug and will not become valid on retry
   */
  private assertPathsValid(paths: string[]): void {
    this.logger.debug({ msg: 'Checking paths validity', paths });
    const badPaths = paths.filter(
      (path) => !isPathWithinAllowedSubPaths({ relativePath: path, basePath: this.fsConfig.basePath, allowedSubPaths: this.fsConfig.subPaths })
    );

    if (badPaths.length > 0) {
      const { basePath, subPaths } = this.fsConfig;
      this.logger.error({ msg: 'Paths validity check failed', badPaths, basePath, allowedSubPaths: subPaths });
      throw new UnrecoverableError(
        `Cannot delete paths outside the configured sub paths (${subPaths.join(', ')}) of base path '${basePath}', or the sub paths themselves: ${badPaths.join(', ')}`
      );
    }

    this.logger.debug({ msg: 'Paths validity check succeeded' });
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
