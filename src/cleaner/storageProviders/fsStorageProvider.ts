import { join } from 'node:path';
import { stat, unlink, rmdir } from 'node:fs/promises';
import type { Logger } from '@map-colonies/js-logger';
import type { IStorageProvider } from './iStorageProvider';

export class FsStorageProvider implements IStorageProvider {
  public constructor(private readonly logger: Logger) {}

  public async targetExists(storageTarget: string, relativePath: string): Promise<boolean> {
    try {
      await stat(join(storageTarget, relativePath));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  public async delete(paths: string[], storageTarget: string): Promise<string[]> {
    if (paths.length === 0) {
      return [];
    }

    this.logger.info({ msg: 'Deleting files from filesystem', basePath: storageTarget, count: paths.length });

    const results = await Promise.allSettled(
      paths.map(async (relativePath) => {
        try {
          await unlink(join(storageTarget, relativePath));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
          }
          throw error;
        }
      })
    );

    const failedPaths: string[] = [];
    for (const [idx, result] of results.entries()) {
      if (result.status === 'rejected') {
        const relativePath = paths[idx]!;
        this.logger.warn({ msg: 'Failed to delete file', path: join(storageTarget, relativePath), error: result.reason });
        failedPaths.push(relativePath);
      }
    }

    await this.cleanupEmptyDirs(paths, storageTarget);

    return failedPaths;
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
}
