import type { TileRange } from '@map-colonies/raster-shared';

/**
 * Sized so one run crosses every batching boundary: 180 tiles at `strategyBatchSize` 40 is
 * four full batches flushed in two groups of `strategyConcurrency`, followed by a 20-tile
 * trailing partial batch. Each 40-key batch then re-chunks into 25 + 15 inside the S3
 * provider's own delete loop, which a production-sized batch never reaches — its cap is 1000
 * keys, well above the strategy's batch size.
 */
const BATCHING_SCENARIO = {
  range: { zoom: 12, minX: 0, maxX: 11, minY: 0, maxY: 14 } satisfies TileRange,
  tileCount: 180,
  strategyBatchSize: 40,
  strategyConcurrency: 2,
  s3ChunkSize: 25,
  /** One `updateProgress` call per flush of `strategyConcurrency` full batches. */
  expectedFlushCount: 2,
  /** Math.round((80 / 180) * 100) and Math.round((160 / 180) * 100) — one per flush. */
  firstFlushPercentage: 44,
  secondFlushPercentage: 89,
};

/**
 * Two ranges sharing a zoom but disjoint in X, plus one at a zoom far enough away that no
 * padded or adjacent-zoom bystander tile collides with another range's targets.
 */
const MULTIPLE_RANGES_SCENARIO = {
  ranges: [
    { zoom: 10, minX: 0, maxX: 2, minY: 0, maxY: 2 },
    { zoom: 10, minX: 10, maxX: 12, minY: 10, maxY: 12 },
    { zoom: 14, minX: 5, maxX: 6, minY: 5, maxY: 6 },
  ] satisfies TileRange[],
  tileCount: 22,
};

export { BATCHING_SCENARIO, MULTIPLE_RANGES_SCENARIO };
