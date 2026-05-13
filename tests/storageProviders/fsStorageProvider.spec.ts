import { stat, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Stats } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FsStorageProvider } from '@src/cleaner/storageProviders/fsStorageProvider';
import { createMockLogger } from '../helpers/mocks';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
}));

const BASE_PATH = '/tiles/test';

describe('FsStorageProvider', () => {
  let provider: FsStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stat).mockResolvedValue({} as Stats);
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(rmdir).mockResolvedValue(undefined);
    provider = new FsStorageProvider(createMockLogger());
  });

  describe('targetExists', () => {
    const RELATIVE_PATH = 'layer/v1';

    it('should call stat with join(storageTarget, relativePath)', async () => {
      const result = await provider.targetExists(BASE_PATH, RELATIVE_PATH);

      expect(result).toBe(true);
      expect(stat).toHaveBeenCalledWith(join(BASE_PATH, RELATIVE_PATH));
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

  describe('delete', () => {
    it('should return empty array for empty input', async () => {
      const result = await provider.delete([], BASE_PATH);
      expect(result).toEqual([]);
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

    it('should return empty array when all unlinks succeed', async () => {
      const result = await provider.delete(['tile/10/0/0.png', 'tile/10/0/1.png'], BASE_PATH);
      expect(result).toEqual([]);
    });

    it('should treat ENOENT as a failed deletion (included in failure report)', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      vi.mocked(unlink).mockRejectedValue(enoent);

      const result = await provider.delete(['tile/10/0/0.png'], BASE_PATH);

      expect(result).toEqual(['tile/10/0/0.png']);
    });

    it('should return failed path for non-ENOENT errors', async () => {
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      vi.mocked(unlink).mockRejectedValue(permError);

      const result = await provider.delete(['tile/10/0/0.png'], BASE_PATH);

      expect(result).toEqual(['tile/10/0/0.png']);
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

      expect(result).toEqual(['tile/10/0/1.png', 'tile/10/0/2.png']);
    });

    it('should use relative path as key in failed paths (not the full absolute path)', async () => {
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      vi.mocked(unlink).mockRejectedValue(permError);

      const relativePath = 'layer/v1/10/5/3.png';
      const result = await provider.delete([relativePath], BASE_PATH);

      expect(result).toEqual([relativePath]);
      expect(result[0]).not.toContain(BASE_PATH);
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

        // Should not throw and should return correct failed paths
        await expect(provider.delete(['tile/10/0/0.png'], BASE_PATH)).resolves.toEqual([]);
      });

      it('should not call rmdir when input is empty', async () => {
        await provider.delete([], BASE_PATH);
        expect(rmdir).not.toHaveBeenCalled();
      });
    });
  });
});
