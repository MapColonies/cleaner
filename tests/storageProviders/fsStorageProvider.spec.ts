import type { Stats } from 'node:fs';
import { rm, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from '@src/cleaner/errors';
import { FsStorageProvider } from '@src/cleaner/storageProviders/fsStorageProvider';
import { createFsStorageConfig, createMockLogger, FS_VALIDATED_CONFIG_DEFAULTS } from '../helpers/mocks';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
  rm: vi.fn(),
}));

const BASE_PATH = FS_VALIDATED_CONFIG_DEFAULTS.basePath;
const SUB_PATH = FS_VALIDATED_CONFIG_DEFAULTS.subPaths[0]!;

describe('FsStorageProvider', () => {
  let provider: FsStorageProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stat).mockResolvedValue({} as Stats);
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(rmdir).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    mockLogger = createMockLogger();
    provider = new FsStorageProvider(createFsStorageConfig(), mockLogger);
  });

  describe('#constructor', () => {
    it('should return an instance of the class', () => {
      const provider = new FsStorageProvider(createFsStorageConfig({ basePath: '/other/base' }), mockLogger);

      expect(provider).toBeInstanceOf(FsStorageProvider);
    });
  });

  describe('#targetExists', () => {
    const RELATIVE_PATH = 'layer/v1';

    it('should call stat with the base path, sub path and relative path joined', async () => {
      const result = await provider.targetExists(SUB_PATH, RELATIVE_PATH);

      expect(result).toBe(true);
      expect(stat).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, RELATIVE_PATH));
    });

    it('should return false when path does not exist (ENOENT)', async () => {
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await provider.targetExists(SUB_PATH, RELATIVE_PATH);

      expect(result).toBe(false);
    });

    it('should throw an errors that are not ENOENT', async () => {
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      await expect(provider.targetExists(SUB_PATH, RELATIVE_PATH)).rejects.toThrow('EACCES');
    });

    it('should throw UnrecoverableError for a sub path outside the configured sub paths', async () => {
      await expect(provider.targetExists('somewhere-else', RELATIVE_PATH)).rejects.toThrow(UnrecoverableError);
      expect(stat).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError for a sub path that traverses out of the base path', async () => {
      await expect(provider.targetExists(`${SUB_PATH}/../../..`, RELATIVE_PATH)).rejects.toThrow(UnrecoverableError);
      expect(stat).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError when the relative path traverses out of the sub path', async () => {
      await expect(provider.targetExists(SUB_PATH, '../../..')).rejects.toThrow(UnrecoverableError);
      expect(stat).not.toHaveBeenCalled();
    });

    it('should accept a sub path nested deeper inside a configured sub path', async () => {
      const result = await provider.targetExists(`${SUB_PATH}/nested`, RELATIVE_PATH);

      expect(result).toBe(true);
      expect(stat).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'nested', RELATIVE_PATH));
    });
  });

  describe('#delete', () => {
    it('should return empty failures map for empty input', async () => {
      const result = await provider.delete(SUB_PATH, []);
      expect(result).toEqual({ failures: new Map() });
      expect(unlink).not.toHaveBeenCalled();
    });

    it('should call unlink with joined base path and relative path', async () => {
      await provider.delete(SUB_PATH, ['layer/v1/10/0/0.png']);

      expect(unlink).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'layer/v1/10/0/0.png'));
    });

    it('should join a nested sub path onto the base path', async () => {
      await provider.delete(`${SUB_PATH}/nested`, ['tile/10/0/0.png']);

      expect(unlink).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'nested', 'tile/10/0/0.png'));
    });

    it('should call unlink for every path', async () => {
      const paths = ['tile/10/0/0.png', 'tile/10/0/1.png', 'tile/10/1/0.png'];

      await provider.delete(SUB_PATH, paths);

      expect(unlink).toHaveBeenCalledTimes(3);
      for (const p of paths) {
        expect(unlink).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, p));
      }
    });

    it('should return empty failures map when all unlinks succeed', async () => {
      const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png', 'tile/10/0/1.png']);
      expect(result).toEqual({ failures: new Map() });
    });

    it('should treat ENOENT as a failed deletion tagged with ENOENT reason', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      vi.mocked(unlink).mockRejectedValue(enoent);

      const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png']);

      expect(result).toEqual({ failures: new Map([['ENOENT', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should return failed path with reason for non-ENOENT errors', async () => {
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      vi.mocked(unlink).mockRejectedValue(permError);

      const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png']);

      expect(result).toEqual({ failures: new Map([['EACCES', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should fall back to error message when error has no errno code', async () => {
      vi.mocked(unlink).mockRejectedValue(new Error('disk on fire'));

      const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png']);

      expect(result).toEqual({ failures: new Map([['disk on fire', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should fall back to "Unknown" when error has neither errno code nor message', async () => {
      vi.mocked(unlink).mockRejectedValue(new Error(''));

      const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png']);

      expect(result).toEqual({ failures: new Map([['Unknown', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should tag failures with the stringified value when a non-Error is thrown', async () => {
      vi.mocked(unlink).mockRejectedValue('raw string failure');

      const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png']);

      expect(result).toEqual({ failures: new Map([['raw string failure', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should fall back to "Unknown" when a non-Error empty value is thrown', async () => {
      vi.mocked(unlink).mockRejectedValue('');

      const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png']);

      expect(result).toEqual({ failures: new Map([['Unknown', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should fall back to a generic reason when the thrown value cannot be stringified', async () => {
      vi.mocked(unlink).mockRejectedValue({
        toString: () => {
          throw new Error('toString failed');
        },
      });

      const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png']);

      expect(result).toEqual({ failures: new Map([['non-serializable thrown value', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should unlink every path of a large input', async () => {
      const paths = Array.from({ length: 7 }, (_, i) => `tile/10/0/${i}.png`);

      await provider.delete(SUB_PATH, paths);

      expect(unlink).toHaveBeenCalledTimes(7);
      for (const path of paths) {
        expect(unlink).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, path));
      }
    });

    it('should aggregate failures of the same reason keeping the first sample', async () => {
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      vi.mocked(unlink).mockRejectedValue(permError);
      const paths = Array.from({ length: 7 }, (_, i) => `tile/10/0/${i}.png`);

      const result = await provider.delete(SUB_PATH, paths);

      expect(result).toEqual({ failures: new Map([['EACCES', { count: 7, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should handle mixed success, ENOENT and real errors', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });

      vi.mocked(unlink)
        .mockResolvedValueOnce(undefined) // success
        .mockRejectedValueOnce(enoent) // ENOENT → failure
        .mockRejectedValueOnce(permError); // real error → failure

      const paths = ['tile/10/0/0.png', 'tile/10/0/1.png', 'tile/10/0/2.png'];
      const result = await provider.delete(SUB_PATH, paths);

      expect(result).toEqual({
        failures: new Map([
          ['ENOENT', { count: 1, sample: 'tile/10/0/1.png' }],
          ['EACCES', { count: 1, sample: 'tile/10/0/2.png' }],
        ]),
      });
    });

    it('should use relative path (not the full absolute path) in failure entries', async () => {
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      vi.mocked(unlink).mockRejectedValue(permError);

      const relativePath = 'layer/v1/10/5/3.png';
      const result = await provider.delete(SUB_PATH, [relativePath]);

      expect(result).toEqual({ failures: new Map([['EACCES', { count: 1, sample: relativePath }]]) });
      expect(Array.from(result.failures.values())[0]?.sample).not.toMatch(`^${BASE_PATH}*`);
    });

    describe('cleanupEmptyDirs', () => {
      it('should attempt to rmdir the parent directory after deletion', async () => {
        await provider.delete(SUB_PATH, ['layer/v1/10/0/0.png']);

        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'layer/v1/10/0'));
      });

      it('should attempt to rmdir all ancestor directories bottom-up', async () => {
        await provider.delete(SUB_PATH, ['layer/v1/10/0/0.png']);

        // x dir → zoom dir → version dir → layer dir (deepest first)
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'layer/v1/10/0'));
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'layer/v1/10'));
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'layer/v1'));
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'layer'));
      });

      it('should deduplicate rmdir calls for shared parent directories', async () => {
        // Both tiles share the same x-dir and zoom dir
        await provider.delete(SUB_PATH, ['tile/10/0/0.png', 'tile/10/0/1.png']);

        const rmdirCalls = vi.mocked(rmdir).mock.calls.map(([p]) => p);
        const xDirCalls = rmdirCalls.filter((p) => p === join(BASE_PATH, SUB_PATH, 'tile/10/0'));
        expect(xDirCalls).toHaveLength(1);
      });

      it('should silently ignore rmdir failures (ENOTEMPTY)', async () => {
        const enotempty = Object.assign(new Error('ENOTEMPTY'), { code: 'ENOTEMPTY' });
        vi.mocked(rmdir).mockRejectedValue(enotempty);

        const result = await provider.delete(SUB_PATH, ['tile/10/0/0.png']);

        // Should not throw and should return correct failed paths
        expect(result).toEqual({ failures: new Map() });
      });

      it('should not call rmdir when input is empty', async () => {
        await provider.delete(SUB_PATH, []);
        expect(rmdir).not.toHaveBeenCalled();
      });

      it('should not call rmdir for a path that has no directory segments', async () => {
        await provider.delete(SUB_PATH, ['0.png']);

        expect(unlink).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, '0.png'));
        expect(rmdir).not.toHaveBeenCalled();
      });

      it('should attempt to rmdir ancestors of paths from every batch', async () => {
        // batchSize is 3 → cleanup runs once for all paths, after the last batch
        const paths = Array.from({ length: 4 }, (_, i) => `tile/10/${i}/0.png`);

        await provider.delete(SUB_PATH, paths);

        for (let i = 0; i < 4; i++) {
          expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, `tile/10/${i}`));
        }
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'tile/10'));
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, SUB_PATH, 'tile'));
      });

      it('should attempt to rmdir deeper directories before their ancestors', async () => {
        await provider.delete(SUB_PATH, ['layer/v1/10/0/0.png']);

        const order = vi.mocked(rmdir).mock.calls.map(([path]) => path);
        expect(order).toEqual([
          join(BASE_PATH, SUB_PATH, 'layer/v1/10/0'),
          join(BASE_PATH, SUB_PATH, 'layer/v1/10'),
          join(BASE_PATH, SUB_PATH, 'layer/v1'),
          join(BASE_PATH, SUB_PATH, 'layer'),
        ]);
      });
    });
  });

  describe('#deleteResources', () => {
    const FS_SUB_PATH = FS_VALIDATED_CONFIG_DEFAULTS.subPaths[0]!;
    const RELATIVE_PATH = 'layer/v1';

    it('should successfully return without failures for empty paths', async () => {
      const result = await provider.deleteResources({ paths: [], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      expect(result).toEqual({ failures: new Map() });
      expect(rm).not.toHaveBeenCalled();
    });

    it('should successfully call delete all files and return without failures', async () => {
      const result = await provider.deleteResources({ paths: [RELATIVE_PATH], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      expect(result).toEqual({ failures: new Map() });
      expect(rm).toHaveBeenCalledWith(join(BASE_PATH, FS_SUB_PATH, RELATIVE_PATH), { recursive: true, force: true });
    });

    it('should successfully call delete all files and return without failures for multiple paths', async () => {
      const result = await provider.deleteResources({ paths: [RELATIVE_PATH, RELATIVE_PATH], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      expect(result).toEqual({ failures: new Map() });
      expect(rm).toHaveBeenCalledWith(join(BASE_PATH, FS_SUB_PATH, RELATIVE_PATH), { recursive: true, force: true });
    });

    it('should successfully call delete all files and return without failures for multiple paths', async () => {
      const result = await provider.deleteResources({ paths: [RELATIVE_PATH, `${RELATIVE_PATH}/old`], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      expect(result).toEqual({ failures: new Map() });
      expect(rm).toHaveBeenCalledWith(join(BASE_PATH, FS_SUB_PATH, RELATIVE_PATH), { recursive: true, force: true });
    });

    it('should throw UnrecoverableError when a path escapes the base path via traversal', async () => {
      const result = provider.deleteResources({ paths: ['../../../../etc/passwd'], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(rm).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError when only one of several paths escapes the base path', async () => {
      const result = provider.deleteResources({ paths: [RELATIVE_PATH, '../../../../escape'], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(rm).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError when a path resolves to the base path itself', async () => {
      const result = provider.deleteResources({ paths: ['../../../'], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(rm).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError when a path resolves to the base path itself via "."', async () => {
      const result = provider.deleteResources({ paths: ['../../../.'], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(rm).not.toHaveBeenCalled();
    });

    it('should return failures entry when rm rejects', async () => {
      vi.mocked(rm).mockRejectedValue(new Error('EACCES'));

      const result = await provider.deleteResources({ paths: [RELATIVE_PATH], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      expect(result).toEqual({
        failures: new Map([['EACCES', { count: 1, sample: join(BASE_PATH, FS_SUB_PATH, RELATIVE_PATH) }]]),
      });
    });

    it('should not throw when rm rejects', async () => {
      vi.mocked(rm).mockRejectedValue(new Error('Permission denied'));

      const result = provider.deleteResources({ paths: [RELATIVE_PATH], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      await expect(result).resolves.not.toThrow();
    });

    it('should rm every path when the input spans multiple batches', async () => {
      // batchSize is 3 → 7 paths span 3 batches (3 + 3 + 1)
      const paths = Array.from({ length: 7 }, (_, i) => `layer/v${i}`);

      await provider.deleteResources({ paths, subPath: FS_SUB_PATH, storageProvider: 'FS' });

      expect(rm).toHaveBeenCalledTimes(7);
      for (const path of paths) {
        expect(rm).toHaveBeenCalledWith(join(BASE_PATH, FS_SUB_PATH, path), { recursive: true, force: true });
      }
    });

    it('should accumulate failures of the same reason across batches keeping the first sample', async () => {
      vi.mocked(rm).mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
      const paths = Array.from({ length: 7 }, (_, i) => `layer/v${i}`);

      const result = await provider.deleteResources({ paths, subPath: FS_SUB_PATH, storageProvider: 'FS' });

      expect(result).toEqual({
        failures: new Map([['EACCES', { count: 7, sample: join(BASE_PATH, FS_SUB_PATH, 'layer/v0') }]]),
      });
    });

    it('should group failures by reason across batches', async () => {
      const paths = ['layer/v0', 'layer/v1', 'layer/v2', 'layer/v3'];
      vi.mocked(rm)
        .mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }))
        // 4th path lands in the second batch
        .mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      const result = await provider.deleteResources({ paths, subPath: FS_SUB_PATH, storageProvider: 'FS' });

      expect(result).toEqual({
        failures: new Map([
          ['EACCES', { count: 2, sample: join(BASE_PATH, FS_SUB_PATH, 'layer/v0') }],
          ['EBUSY', { count: 1, sample: join(BASE_PATH, FS_SUB_PATH, 'layer/v2') }],
        ]),
      });
    });

    it('should throw UnrecoverableError when a path does not sit under any configured subPath', async () => {
      const result = provider.deleteResources({ paths: [RELATIVE_PATH], subPath: 'unconfigured/subPath', storageProvider: 'FS' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(rm).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError when a path resolves to the configured subPath itself', async () => {
      const result = provider.deleteResources({ paths: [''], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(rm).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError when a path escapes into a sibling that shares the subPath prefix', async () => {
      // resolves to '<basePath>/artifacts/tiles-backup' — under the base path, but outside the configured subPath
      const result = provider.deleteResources({ paths: ['../tiles-backup'], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(rm).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError when only one of several paths escapes the configured subPath', async () => {
      const result = provider.deleteResources({ paths: [RELATIVE_PATH, '../tiles-backup'], subPath: FS_SUB_PATH, storageProvider: 'FS' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(rm).not.toHaveBeenCalled();
    });
  });
});
