import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
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
        // idx is always within bounds: results.length === paths.length
        const relativePath = paths[idx]!;
        this.logger.warn({ msg: 'Failed to delete file', path: join(storageTarget, relativePath), error: result.reason });
        failedPaths.push(relativePath);
      }
    }

    return failedPaths;
  }
}
