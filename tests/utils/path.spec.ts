import { describe, expect, it } from 'vitest';
import { isPathWithinAllowedSubPaths, normalizeFolderPath, resolveAbsolutePath } from '@src/cleaner/utils/path';

const BASE_PATH = '/data';
const ALLOWED_SUB_PATHS = ['artifacts/tiles', 'artifacts/gpkgs'];

const isAllowed = (relativePath: string): boolean =>
  isPathWithinAllowedSubPaths({ relativePath, basePath: BASE_PATH, allowedSubPaths: ALLOWED_SUB_PATHS });

describe('path', () => {
  describe('#normalizeFolderPath', () => {
    it('should append a trailing separator when missing', () => {
      expect(normalizeFolderPath('a/b')).toBe('a/b/');
    });

    it('should leave an already terminated path unchanged', () => {
      expect(normalizeFolderPath('a/b/')).toBe('a/b/');
    });
  });

  describe('#resolveAbsolutePath', () => {
    it('should prefix a relative path with the root separator', () => {
      expect(resolveAbsolutePath('data/tiles')).toBe('/data/tiles');
    });

    it('should collapse traversal segments', () => {
      expect(resolveAbsolutePath('/data/tiles/../gpkgs')).toBe('/data/gpkgs');
    });
  });

  describe('#isPathWithinAllowedSubPaths', () => {
    it('should allow a path nested under an allowed sub path', () => {
      expect(isAllowed('artifacts/tiles/layer/v1')).toBe(true);
    });

    it('should allow a path under any of the allowed sub paths', () => {
      expect(isAllowed('artifacts/gpkgs/layer.gpkg')).toBe(true);
    });

    it('should reject an allowed sub path root itself', () => {
      expect(isAllowed('artifacts/tiles')).toBe(false);
    });

    it('should reject a path under no allowed sub path', () => {
      expect(isAllowed('somewhere-else/layer')).toBe(false);
    });

    it('should reject a sibling that merely shares the sub path prefix', () => {
      expect(isAllowed('artifacts/tiles-old/layer')).toBe(false);
    });

    it('should reject traversal that escapes the base path', () => {
      expect(isAllowed('artifacts/tiles/../../../etc/passwd')).toBe(false);
    });

    it('should reject traversal that lands back on the base path', () => {
      expect(isAllowed('artifacts/tiles/../..')).toBe(false);
    });

    it('should allow traversal that stays under an allowed sub path', () => {
      expect(isAllowed('artifacts/tiles/layer/../v2')).toBe(true);
    });

    it('should reject every path when no sub paths are allowed', () => {
      expect(isPathWithinAllowedSubPaths({ relativePath: 'artifacts/tiles/layer', basePath: BASE_PATH, allowedSubPaths: [] })).toBe(false);
    });
  });
});
