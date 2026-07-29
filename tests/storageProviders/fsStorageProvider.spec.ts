import { accessSync, Stats, statSync } from 'node:fs';
import { rm, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { faker } from '@faker-js/faker';
import { ConfigurationError, UnrecoverableError } from '@src/cleaner/errors';
import { FsStorageProvider, type FsConfig } from '@src/cleaner/storageProviders/fsStorageProvider';
import type { ConfigType } from '@src/common/config';
import { createMockFsConfig, createMockLogger, FS_STORAGE_CONFIG_DEFAULTS } from '../helpers/mocks';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
  rm: vi.fn(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const originModule = await importOriginal();
  return {
    ...originModule,
    accessSync: vi.fn(),
    statSync: vi.fn(),
  };
});
const BASE_PATH = FS_STORAGE_CONFIG_DEFAULTS.basePath;

describe('FsStorageProvider', () => {
  let provider: FsStorageProvider;
  let mockLogger: Logger;
  let mockConfig: ConfigType;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stat).mockResolvedValue({} as Stats);
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(rmdir).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(accessSync).mockReturnValue(undefined);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as Stats);
    mockLogger = createMockLogger();
    mockConfig = createMockFsConfig();
    provider = new FsStorageProvider(mockConfig, mockLogger);
  });

  describe('#targetExists', () => {
    const RELATIVE_PATH = 'layer/v1';

    it('should call stat with full target path', async () => {
      const targetPath = join(BASE_PATH, RELATIVE_PATH);
      const result = await provider.targetExists(BASE_PATH, RELATIVE_PATH);

      expect(result).toBe(true);
      expect(stat).toHaveBeenCalledWith(targetPath);
    });

    it('should return false when path does not exist (ENOENT)', async () => {
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await provider.targetExists(BASE_PATH, RELATIVE_PATH);

      expect(result).toBe(false);
    });

    it('should throw an errors that are not ENOENT', async () => {
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      await expect(provider.targetExists(BASE_PATH, RELATIVE_PATH)).rejects.toThrow('EACCES');
    });
  });

  describe('#delete', () => {
    it('should return empty failures map for empty input', async () => {
      const result = await provider.delete([], BASE_PATH);
      expect(result).toEqual({ failures: new Map() });
      expect(unlink).not.toHaveBeenCalled();
    });

    it('should call unlink with joined base path and relative path', async () => {
      await provider.delete(['layer/v1/10/0/0.png'], BASE_PATH);

      expect(unlink).toHaveBeenCalledWith(join(BASE_PATH, 'layer/v1/10/0/0.png'));
    });

    it('should call unlink for every path', async () => {
      const paths = ['tile/10/0/0.png', 'tile/10/0/1.png', 'tile/10/1/0.png'];

      await provider.delete(paths, BASE_PATH);

      expect(unlink).toHaveBeenCalledTimes(3);
      for (const p of paths) {
        expect(unlink).toHaveBeenCalledWith(join(BASE_PATH, p));
      }
    });

    it('should return empty failures map when all unlinks succeed', async () => {
      const result = await provider.delete(['tile/10/0/0.png', 'tile/10/0/1.png'], BASE_PATH);
      expect(result).toEqual({ failures: new Map() });
    });

    it('should treat ENOENT as a failed deletion tagged with ENOENT reason', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      vi.mocked(unlink).mockRejectedValue(enoent);

      const result = await provider.delete(['tile/10/0/0.png'], BASE_PATH);

      expect(result).toEqual({ failures: new Map([['ENOENT', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should return failed path with reason for non-ENOENT errors', async () => {
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      vi.mocked(unlink).mockRejectedValue(permError);

      const result = await provider.delete(['tile/10/0/0.png'], BASE_PATH);

      expect(result).toEqual({ failures: new Map([['EACCES', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should fall back to error message when error has no errno code', async () => {
      vi.mocked(unlink).mockRejectedValue(new Error('disk on fire'));

      const result = await provider.delete(['tile/10/0/0.png'], BASE_PATH);

      expect(result).toEqual({ failures: new Map([['disk on fire', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should fall back to "Unknown" when error has neither errno code nor message', async () => {
      vi.mocked(unlink).mockRejectedValue(new Error(''));

      const result = await provider.delete(['tile/10/0/0.png'], BASE_PATH);

      expect(result).toEqual({ failures: new Map([['Unknown', { count: 1, sample: 'tile/10/0/0.png' }]]) });
    });

    it('should handle mixed success, ENOENT and real errors', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });

      vi.mocked(unlink)
        .mockResolvedValueOnce(undefined) // success
        .mockRejectedValueOnce(enoent) // ENOENT → failure
        .mockRejectedValueOnce(permError); // real error → failure

      const paths = ['tile/10/0/0.png', 'tile/10/0/1.png', 'tile/10/0/2.png'];
      const result = await provider.delete(paths, BASE_PATH);

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
      const result = await provider.delete([relativePath], BASE_PATH);

      expect(result).toEqual({ failures: new Map([['EACCES', { count: 1, sample: relativePath }]]) });
      expect(Array.from(result.failures.values())[0]?.sample).not.toMatch(`^${BASE_PATH}*`);
    });

    describe('cleanupEmptyDirs', () => {
      it('should attempt to rmdir the parent directory after deletion', async () => {
        await provider.delete(['layer/v1/10/0/0.png'], BASE_PATH);

        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, 'layer/v1/10/0'));
      });

      it('should attempt to rmdir all ancestor directories bottom-up', async () => {
        await provider.delete(['layer/v1/10/0/0.png'], BASE_PATH);

        // x dir → zoom dir → version dir → layer dir (deepest first)
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, 'layer/v1/10/0'));
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, 'layer/v1/10'));
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, 'layer/v1'));
        expect(rmdir).toHaveBeenCalledWith(join(BASE_PATH, 'layer'));
      });

      it('should deduplicate rmdir calls for shared parent directories', async () => {
        // Both tiles share the same x-dir and zoom dir
        await provider.delete(['tile/10/0/0.png', 'tile/10/0/1.png'], BASE_PATH);

        const rmdirCalls = vi.mocked(rmdir).mock.calls.map(([p]) => p);
        const xDirCalls = rmdirCalls.filter((p) => p === join(BASE_PATH, 'tile/10/0'));
        expect(xDirCalls).toHaveLength(1);
      });

      it('should silently ignore rmdir failures (ENOTEMPTY)', async () => {
        const enotempty = Object.assign(new Error('ENOTEMPTY'), { code: 'ENOTEMPTY' });
        vi.mocked(rmdir).mockRejectedValue(enotempty);

        const result = await provider.delete(['tile/10/0/0.png'], BASE_PATH);

        // Should not throw and should return correct failed paths
        expect(result).toEqual({ failures: new Map() });
      });

      it('should not call rmdir when input is empty', async () => {
        await provider.delete([], BASE_PATH);
        expect(rmdir).not.toHaveBeenCalled();
      });
    });
  });

  describe('#deleteResources', () => {
    const FS_SUB_PATH = FS_STORAGE_CONFIG_DEFAULTS.subPaths.tiles;
    const RELATIVE_PATH = 'layer/v1';

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
  });

  describe('#constructor', () => {
    it('should construct successfully when the base path is accessible and is a directory', () => {
      expect(() => new FsStorageProvider(mockConfig, mockLogger)).not.toThrow();
      expect(accessSync).toHaveBeenCalledWith(FS_STORAGE_CONFIG_DEFAULTS.basePath, expect.any(Number));
      expect(statSync).toHaveBeenCalledWith(FS_STORAGE_CONFIG_DEFAULTS.basePath);
    });

    it('should throw ConfigurationError when the base path does not exist', () => {
      vi.mocked(accessSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      expect(() => new FsStorageProvider(mockConfig, mockLogger)).toThrow(ConfigurationError);
    });

    it('should throw ConfigurationError when access to the base path is denied (EACCES)', () => {
      vi.mocked(accessSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      });

      expect(() => new FsStorageProvider(mockConfig, mockLogger)).toThrow(ConfigurationError);
    });

    it('should throw ConfigurationError when access to the base path is denied (EPERM)', () => {
      vi.mocked(accessSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      });

      expect(() => new FsStorageProvider(mockConfig, mockLogger)).toThrow(ConfigurationError);
    });

    it('should throw ConfigurationError when the base path exists but is not a directory', () => {
      vi.mocked(statSync).mockReturnValueOnce({ isDirectory: () => false } as Stats);

      expect(() => new FsStorageProvider(mockConfig, mockLogger)).toThrow(ConfigurationError);
    });

    it('should resolve a relative base path (without a leading separator) to an absolute path', () => {
      const relativeConfig = {
        get: vi.fn().mockReturnValue({
          ...FS_STORAGE_CONFIG_DEFAULTS,
          ...({ basePath: 'relative/tiles' } satisfies Pick<FsConfig, 'basePath'>),
        }),
      } as unknown as ConfigType;

      expect(() => new FsStorageProvider(relativeConfig, createMockLogger())).not.toThrow();
      expect(accessSync).toHaveBeenCalledWith('/relative/tiles', expect.any(Number));
    });

    it('should throw ConfigurationError for an unexpected accessibility error', () => {
      vi.mocked(accessSync).mockImplementationOnce(() => {
        throw new Error('disk exploded');
      });

      expect(() => new FsStorageProvider(mockConfig, mockLogger)).toThrow(ConfigurationError);
    });

    it('should throw ConfigurationError when batchSize is less than or equal to 0', () => {
      const zeroBatchConfig = createMockFsConfig({ delete: { batchSize: faker.number.int({ max: 0, min: -Number.MAX_SAFE_INTEGER }) } });

      expect(() => new FsStorageProvider(zeroBatchConfig, mockLogger)).toThrow(ConfigurationError);
    });
  });
});
