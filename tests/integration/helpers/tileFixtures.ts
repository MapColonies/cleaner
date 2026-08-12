import type { TileRange } from '@map-colonies/raster-shared';
import type { TilesDeletionCommon } from '../../helpers/fakes/tilesDeletionFakes';

// First 4 bytes of a PNG file header (\x89 P N G). Content is arbitrary;
// eslint-disable-next-line @typescript-eslint/no-magic-numbers
const TINY_TILE_BODY = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Every path returned here is relative to the storage target — the bucket for S3,
 * the task's sub path for FS — exactly as `TilesDeletionStrategy` generates them.
 */
function tilePathsForRange(range: TileRange, tilesRelativePath: string, fileExtension: string): string[] {
  const paths: string[] = [];
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) {
      paths.push(`${tilesRelativePath}/${range.zoom}/${x}/${y}.${fileExtension}`);
    }
  }
  return paths;
}

function tilePathsForRanges(params: TilesDeletionCommon): string[] {
  return params.ranges.flatMap((range) => tilePathsForRange(range, params.tilesRelativePath, params.fileExtension));
}

function paddedRange(range: TileRange, padding: number): TileRange {
  return {
    zoom: range.zoom,
    minX: Math.max(0, range.minX - padding),
    maxX: range.maxX + padding,
    minY: Math.max(0, range.minY - padding),
    maxY: range.maxY + padding,
  };
}

/**
 * Builds the set of tiles inside the `paddedRange` but **outside** the original
 * `params.ranges`. These tiles are seeded into the backend before the strategy
 * runs and MUST survive — they prove "only the supplied ranges are deleted".
 */
function extraTilePathsAroundRanges(params: TilesDeletionCommon, padding: number): string[] {
  const targetSet = new Set(tilePathsForRanges(params));
  const extras: string[] = [];
  for (const range of params.ranges) {
    const wider = paddedRange(range, padding);
    for (const path of tilePathsForRange(wider, params.tilesRelativePath, params.fileExtension)) {
      if (!targetSet.has(path)) {
        extras.push(path);
      }
    }
  }
  return extras;
}

/**
 * Returns one tile path per (range × zoomDelta) pair, placed at a zoom level
 * adjacent to each range's zoom.
 *
 * Like `extraTilePathsAroundRanges`, the returned paths are seeded before the
 * test and must survive after the strategy runs.
 * */
function extraTilePathsAtAdjacentZooms(params: TilesDeletionCommon, zoomDeltas: number[]): string[] {
  const extras: string[] = [];
  for (const range of params.ranges) {
    for (const delta of zoomDeltas) {
      const zoom = range.zoom + delta;
      if (zoom < 0) continue;
      extras.push(`${params.tilesRelativePath}/${zoom}/${range.minX}/${range.minY}.${params.fileExtension}`);
    }
  }
  return extras;
}

export { tilePathsForRange, tilePathsForRanges, paddedRange, extraTilePathsAroundRanges, extraTilePathsAtAdjacentZooms, TINY_TILE_BODY };
