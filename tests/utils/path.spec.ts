import type { TileRange } from '@map-colonies/raster-shared';
import { describe, expect, it } from 'vitest';
import {
  generateRedisTileKeys,
  generateTilePaths,
  isPathWithinAllowedSubPaths,
  normalizeFolderPath,
  resolveAbsolutePath,
} from '@src/cleaner/utils/path';

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

  describe('#generateTilePaths', () => {
    it('should yield a path per tile, ordered x-major then y', () => {
      const range: TileRange = { zoom: 3, minX: 1, maxX: 2, minY: 5, maxY: 6 };

      expect([...generateTilePaths(range, 'layer/v1', 'png')]).toEqual([
        'layer/v1/3/1/5.png',
        'layer/v1/3/1/6.png',
        'layer/v1/3/2/5.png',
        'layer/v1/3/2/6.png',
      ]);
    });

    it('should yield a single path for a range covering one tile', () => {
      const range: TileRange = { zoom: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };

      expect([...generateTilePaths(range, 'layer/v1', 'jpeg')]).toEqual(['layer/v1/0/0/0.jpeg']);
    });
  });

  describe('#generateRedisTileKeys', () => {
    it('should yield dash-separated keys with zoom first and no file extension', () => {
      const range: TileRange = { zoom: 3, minX: 1, maxX: 2, minY: 5, maxY: 6 };

      expect([...generateRedisTileKeys(range, 'myLayer-redis_WorldCRS84')]).toEqual([
        'myLayer-redis_WorldCRS84-3-1-5',
        'myLayer-redis_WorldCRS84-3-1-6',
        'myLayer-redis_WorldCRS84-3-2-5',
        'myLayer-redis_WorldCRS84-3-2-6',
      ]);
    });

    // Captured off a live MapProxy command stream (DISCOVERY.md). A wrong key deletes nothing
    // and still reports success, so it is pinned exactly.
    it('should reproduce the key format captured from MapProxy', () => {
      const range: TileRange = { zoom: 12, minX: 4892, maxX: 4892, minY: 2784, maxY: 2784 };

      expect([...generateRedisTileKeys(range, 'benchmark')]).toEqual(['benchmark-12-4892-2784']);
    });

    // Production uses mapproxy-api's `{cacheName}_{gridName}` fallback, not the layer id.
    it('should treat the prefix as an opaque string', () => {
      const range: TileRange = { zoom: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };

      expect([...generateRedisTileKeys(range, 'myLayer-redis_WorldCRS84')]).toEqual(['myLayer-redis_WorldCRS84-0-0-0']);
    });

    it('should yield a single key for a range covering one tile', () => {
      const range: TileRange = { zoom: 21, minX: 7, maxX: 7, minY: 9, maxY: 9 };

      expect([...generateRedisTileKeys(range, 'p')]).toEqual(['p-21-7-9']);
    });
  });
});
