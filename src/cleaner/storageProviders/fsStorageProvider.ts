import { join } from 'node:path';
import { unlink, rmdir } from 'node:fs/promises';
import type { Logger } from '@map-colonies/js-logger';
import type { IStorageProvider } from './iStorageProvider';

export class FsStorageProvider implements IStorageProvider {
  public constructor(private readonly logger: Logger) {}

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

  private async cleanupEmptyDirs(relativePaths: string[], storageTarget: string): Promise<void> {
    const dirsByLevel = new Map<number, Set<string>>();

    for (const relativePath of relativePaths) {
      const parts = relativePath.split('/');
      const segments = parts.slice(0, parts.length - 1); // strip filename
      for (let count = segments.length; count >= 1; count--) {
        const levelIdx = segments.length - count; // 0 = direct parent of tile
        if (!dirsByLevel.has(levelIdx)) {
          dirsByLevel.set(levelIdx, new Set());
        }
        dirsByLevel.get(levelIdx)!.add(join(storageTarget, segments.slice(0, count).join('/')));
      }
    }

    // Process closest-to-tile dirs first so ancestors can become empty
    const sortedLevels = [...dirsByLevel.keys()].sort((a, b) => a - b);
    for (const level of sortedLevels) {
      const dirs = dirsByLevel.get(level)!;
      await Promise.allSettled([...dirs].map(async (dir) => rmdir(dir)));
    }
  }
}
