import { faker } from '@faker-js/faker';
import { StorageProvider, type FsTilesDeletionParams, type S3TilesDeletionParams, type TileRange } from '@map-colonies/raster-shared';

const EXTENSIONS = ['png', 'jpeg'] as const;

/** Fields every path-addressed tiles-deletion member carries, whatever its storage locator. */
type TilesDeletionCommon = Pick<S3TilesDeletionParams, 'ranges' | 'tilesRelativePath' | 'fileExtension'>;
const MIN_FAKE_ZOOM = 10;
const MAX_FAKE_ZOOM = 18;

function buildTileRange(overrides: Partial<TileRange> = {}): TileRange {
  const minX = faker.number.int({ min: 0, max: 50 });
  const minY = faker.number.int({ min: 0, max: 50 });
  return {
    zoom: faker.number.int({ min: MIN_FAKE_ZOOM, max: MAX_FAKE_ZOOM }),
    minX,
    maxX: minX + faker.number.int({ min: 0, max: 5 }),
    minY,
    maxY: minY + faker.number.int({ min: 0, max: 5 }),
    ...overrides,
  };
}

function buildTilesRelativePath(): string {
  return `${faker.word.noun().toLowerCase()}/${faker.string.alphanumeric({ length: 6, casing: 'lower' })}`;
}

function buildTilesDeletionCommon(overrides: Partial<TilesDeletionCommon>): TilesDeletionCommon {
  return {
    tilesRelativePath: overrides.tilesRelativePath ?? buildTilesRelativePath(),
    fileExtension: overrides.fileExtension ?? faker.helpers.arrayElement(EXTENSIONS),
    ranges: overrides.ranges ?? [buildTileRange()],
  };
}

function buildS3TilesDeletionParams(overrides: Partial<S3TilesDeletionParams> = {}): S3TilesDeletionParams {
  return {
    storageProvider: StorageProvider.S3,
    bucket: overrides.bucket ?? `test-${faker.string.alphanumeric({ length: 16, casing: 'lower' })}`,
    ...buildTilesDeletionCommon(overrides),
  };
}

function buildFsTilesDeletionParams(overrides: Partial<FsTilesDeletionParams> = {}): FsTilesDeletionParams {
  return {
    storageProvider: StorageProvider.FS,
    subPath: overrides.subPath ?? buildTilesRelativePath(),
    ...buildTilesDeletionCommon(overrides),
  };
}

export { buildTileRange, buildTilesRelativePath, buildS3TilesDeletionParams, buildFsTilesDeletionParams };
export type { TilesDeletionCommon };
