import { faker } from '@faker-js/faker';
import { SourceType, type TileRange, type TilesDeletionParams } from '@map-colonies/raster-shared';

const EXTENSIONS = ['png', 'jpeg'] as const;
const PROVIDERS = [SourceType.FS, SourceType.S3] as const;

function buildTileRange(overrides: Partial<TileRange> = {}): TileRange {
  const minX = faker.number.int({ min: 0, max: 50 });
  const minY = faker.number.int({ min: 0, max: 50 });
  return {
    zoom: faker.number.int({ min: 0, max: 18 }),
    minX,
    maxX: minX + faker.number.int({ min: 0, max: 5 }),
    minY,
    maxY: minY + faker.number.int({ min: 0, max: 5 }),
    ...overrides,
  };
}

function buildTilesPath(): string {
  return `${faker.word.noun().toLowerCase()}/${faker.string.alphanumeric({ length: 6, casing: 'lower' })}`;
}

function buildBaseParams(overrides: Partial<TilesDeletionParams> = {}): TilesDeletionParams {
  return {
    tilesPath: overrides.tilesPath ?? buildTilesPath(),
    fileExtension: overrides.fileExtension ?? faker.helpers.arrayElement(EXTENSIONS),
    ranges: overrides.ranges ?? [buildTileRange()],
    sourceProvider: overrides.sourceProvider ?? faker.helpers.arrayElement(PROVIDERS),
    ...overrides,
  };
}

export { buildTileRange, buildBaseParams };
