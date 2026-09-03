import { join, resolve, sep } from 'node:path/posix';
import type { TileRange } from '@map-colonies/raster-shared';

export const normalizeFolderPath = (path: string): string => {
  return path.endsWith(sep) ? path : `${path}${sep}`;
};

/**
 * Walks every tile in a range and yields whatever `formatKey` makes of it, so the traversal
 * lives in one place and each provider only supplies its own key shape.
 */
export function* generateRangeKeys(range: TileRange, formatKey: (zoom: number, x: number, y: number) => string): Generator<string> {
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) {
      yield formatKey(range.zoom, x, y);
    }
  }
}

/** Tile paths for the S3 and FS providers, which address a tile identically. */
export const generateTilePaths = (range: TileRange, tilesRelativePath: string, fileExtension: string): Generator<string> =>
  generateRangeKeys(range, (zoom, x, y) => `${tilesRelativePath}/${zoom}/${x}/${y}.${fileExtension}`);

/** Redis tile keys in mapproxy's format */
export const generateRedisTileKeys = (range: TileRange, prefix: string): Generator<string> =>
  generateRangeKeys(range, (zoom, x, y) => `${prefix}-${zoom}-${x}-${y}`);

/**
 * Resolves a file system path to an absolute path.
 * Ensures the path is resolved as an absolute path and properly formatted
 * with a leading separator if not already present.
 * @param path - The input path string to normalize
 * @returns An absolute path with proper path separators
 */
export const resolveAbsolutePath = (path: string): string => {
  return resolve(`${path.startsWith(sep) ? '' : sep}${path}`);
};

/**
 * Guards a caller-supplied relative path before anything is deleted from the filesystem.
 * A path is allowed only when it lives strictly *under* one of the configured sub paths.
 *
 * @param relativePath - Path relative to `basePath`, including the sub path segment
 * @param basePath - Absolute mounted base directory
 * @param allowedSubPaths - Sub paths deletion is permitted under, relative to `basePath`
 * @returns boolean whether `relativePath` passes both checks
 */
export const isPathWithinAllowedSubPaths = ({
  relativePath,
  basePath,
  allowedSubPaths,
}: {
  relativePath: string;
  basePath: string;
  allowedSubPaths: string[];
}): boolean => {
  const startsWithAllowedSubPath = allowedSubPaths.some((subPath) => relativePath.startsWith(normalizeFolderPath(subPath)));
  const absolutePath = resolveAbsolutePath(join(basePath, relativePath));
  const startsWithBasePath = absolutePath.startsWith(normalizeFolderPath(basePath));
  return startsWithAllowedSubPath && startsWithBasePath;
};
