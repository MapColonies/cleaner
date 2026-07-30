import { accessSync, constants, statSync, type Stats } from 'node:fs';
import type { Logger } from '@map-colonies/js-logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@src/cleaner/errors';
import { assertCanDeleteFromFolder } from '@src/cleaner/utils/fs';
import { createMockLogger } from '../helpers/mocks';

vi.mock(import('node:fs'), async (importOriginal) => {
  const originModule = await importOriginal();
  return {
    ...originModule,
    accessSync: vi.fn(),
    statSync: vi.fn(),
  };
});

const PATH = '/test/tiles';

describe('fs', () => {
  describe('#assertCanDeleteFromFolder', () => {
    let mockLogger: Logger;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(accessSync).mockReturnValue(undefined);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as Stats);
      mockLogger = createMockLogger();
    });

    it('should not throw when the path is an accessible directory', () => {
      expect(() => assertCanDeleteFromFolder(PATH, mockLogger)).not.toThrow();
    });

    it('should check the path for existence, read and write access', () => {
      assertCanDeleteFromFolder(PATH, mockLogger);

      expect(accessSync).toHaveBeenCalledWith(PATH, constants.F_OK | constants.R_OK | constants.W_OK);
    });

    it('should check that the path is a directory', () => {
      assertCanDeleteFromFolder(PATH, mockLogger);

      expect(statSync).toHaveBeenCalledWith(PATH);
    });

    it('should throw ConfigurationError when the path does not exist (ENOENT)', () => {
      vi.mocked(accessSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      expect(() => assertCanDeleteFromFolder(PATH, mockLogger)).toThrow(new ConfigurationError(`FS path does not exist: ${PATH}`));
    });

    it('should throw ConfigurationError when access is denied (EACCES)', () => {
      vi.mocked(accessSync).mockImplementation(() => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      });

      expect(() => assertCanDeleteFromFolder(PATH, mockLogger)).toThrow(new ConfigurationError(`FS path permission denied for path: ${PATH}`));
    });

    it('should throw ConfigurationError describing an unexpected accessibility error', () => {
      vi.mocked(accessSync).mockImplementation(() => {
        throw Object.assign(new Error('too many open files'), { code: 'EMFILE' });
      });

      expect(() => assertCanDeleteFromFolder(PATH, mockLogger)).toThrow(
        new ConfigurationError('An unexpected error occurred on FS path accessibility check: EMFILE')
      );
    });

    it('should throw ConfigurationError when the path exists but is a file', () => {
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } satisfies Partial<Stats> as Stats);

      expect(() => assertCanDeleteFromFolder(PATH, mockLogger)).toThrow(
        new ConfigurationError(`FS path exists but it is a file, not a directory: ${PATH}`)
      );
    });

    it('should throw ConfigurationError when the info check fails unexpectedly', () => {
      // e.g. the directory is removed between the accessSync and statSync calls
      vi.mocked(statSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      expect(() => assertCanDeleteFromFolder(PATH, mockLogger)).toThrow(
        new ConfigurationError('An unexpected error occurred on FS info check: ENOENT')
      );
    });

    it('should not re-wrap the not-a-directory ConfigurationError as an info check failure', () => {
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } satisfies Partial<Stats> as Stats);

      expect(() => assertCanDeleteFromFolder(PATH, mockLogger)).not.toThrow(/An unexpected error occurred on FS info check/);
    });
  });
});
