import type { TileRange } from '@map-colonies/raster-shared';

// First 4 bytes of a PNG file header (\x89 P N G). Content is arbitrary;
// eslint-disable-next-line @typescript-eslint/no-magic-numbers
const TINY_TILE_BODY = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Names one tile of a fixed layer, relative to the storage target; see `StorageBackend.tileKey`. */
type TileKeyFormat = (zoom: number, x: number, y: number) => string;

function tileKeysForRange(range: TileRange, format: TileKeyFormat): string[] {
  const keys: string[] = [];
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) {
      keys.push(format(range.zoom, x, y));
    }
  }
  return keys;
}

function tileKeysForRanges(ranges: TileRange[], format: TileKeyFormat): string[] {
  return ranges.flatMap((range) => tileKeysForRange(range, format));
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
 * `ranges`. These tiles are seeded into the backend before the strategy
 * runs and MUST survive — they prove "only the supplied ranges are deleted".
 *
 * Deduped, because with several ranges the padded regions can overlap and yield
 * the same bystander key twice.
 */
function extraTileKeysAroundRanges(ranges: TileRange[], format: TileKeyFormat, padding: number): string[] {
  const targetSet = new Set(tileKeysForRanges(ranges, format));
  const extras = new Set<string>();
  for (const range of ranges) {
    const wider = paddedRange(range, padding);
    for (const key of tileKeysForRange(wider, format)) {
      if (!targetSet.has(key)) {
        extras.add(key);
      }
    }
  }
  return [...extras];
}

/**
 * Returns one tile key per (range × zoomDelta) pair, placed at a zoom level
 * adjacent to each range's zoom.
 *
 * Like `extraTileKeysAroundRanges`, the returned keys are seeded before the
 * test and must survive after the strategy runs.
 * */
function extraTileKeysAtAdjacentZooms(ranges: TileRange[], format: TileKeyFormat, zoomDeltas: number[]): string[] {
  const targetSet = new Set(tileKeysForRanges(ranges, format));
  const extras = new Set<string>();
  for (const range of ranges) {
    for (const delta of zoomDeltas) {
      const zoom = range.zoom + delta;
      if (zoom < 0) continue;
      const key = format(zoom, range.minX, range.minY);
      // With several ranges, one range's neighbouring zoom can be another range's own zoom,
      // where the key is a deletion target rather than a bystander that must survive.
      if (!targetSet.has(key)) {
        extras.add(key);
      }
    }
  }
  return [...extras];
}

const BYSTANDER_PADDING = 1;
/** One zoom below and one above each range. */
// eslint-disable-next-line @typescript-eslint/no-magic-numbers
const BYSTANDER_ZOOM_DELTAS = [-1, 1];

/**
 * Tiles that neighbour `ranges` in X/Y and at the adjacent zooms, deduped. Seeded alongside the
 * targets, they must all survive the run — the one assertion every deletion scenario shares.
 */
function bystanderTileKeys(ranges: TileRange[], format: TileKeyFormat): string[] {
  return [
    ...new Set([
      ...extraTileKeysAroundRanges(ranges, format, BYSTANDER_PADDING),
      ...extraTileKeysAtAdjacentZooms(ranges, format, BYSTANDER_ZOOM_DELTAS),
    ]),
  ];
}

export {
  tileKeysForRange,
  tileKeysForRanges,
  paddedRange,
  extraTileKeysAroundRanges,
  extraTileKeysAtAdjacentZooms,
  bystanderTileKeys,
  TINY_TILE_BODY,
};
export type { TileKeyFormat };
