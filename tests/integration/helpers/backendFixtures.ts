import { join } from 'node:path';
import { faker } from '@faker-js/faker';
import { container } from 'tsyringe';
import { StorageProvider, type FsTilesDeletionParams, type S3TilesDeletionParams } from '@map-colonies/raster-shared';
import type { S3Client } from '@aws-sdk/client-s3';
import { S3StorageProvider, FsStorageProvider, type FsStorageConfig, type StorageProviders } from '@src/cleaner/storageProviders';
import { buildFsTilesDeletionParams, buildS3TilesDeletionParams, type TilesDeletionCommon } from '../../helpers/fakes/tilesDeletionFakes';
import { createMockLogger } from '../../helpers/mocks';
import { startMinio, type MinioHandle } from './minioContainer';
import { buildS3StorageConfigForMinio, createTestS3Client, deleteBucket, ensureBucket, listAllKeys, putManyTiles } from './s3TestKit';
import { listAllFiles, makeTempFsBase, rmBase, writeManyTiles } from './fsTestKit';

/** The storage providers a tiles-deletion task can actually be routed to today (REDIS is not implemented). */
type PathAddressedProvider = Exclude<StorageProvider, 'REDIS'>;
type PathAddressedParams = S3TilesDeletionParams | FsTilesDeletionParams;

/**
 * The only sub path FS deletion is allowed under, mirroring `storage.fs.subPaths` in config.
 * The task's own `subPath` must live inside it or `FsStorageProvider` rejects the paths outright.
 */
const FS_ALLOWED_SUB_PATH = 'artifacts/tiles';
const FS_DELETE_BATCH_SIZE = 100;

interface BackendHandles {
  minio: MinioHandle;
  s3Client: S3Client;
}

interface TestStorageContext {
  providers: StorageProviders;
  /** Bucket the S3 task targets — travels in the task params, not in config. */
  bucket: string;
  /** Mounted root the FS provider is configured with; never referenced by the task. */
  fsBasePath: string;
  /** Sub path of `fsBasePath` the FS task targets — travels in the task params. */
  fsSubPath: string;
}

async function startBackends(): Promise<BackendHandles> {
  const minio = await startMinio();
  const s3Client = createTestS3Client(minio);
  return { minio, s3Client };
}

async function stopBackends({ minio, s3Client }: BackendHandles): Promise<void> {
  s3Client.destroy();
  await minio.stop();
}

/** Per-provider delete batch sizes; each falls back to the production-shaped default. */
interface ProviderBatchSizes {
  /** Keys per `DeleteObjects` call the S3 provider chunks its input into. */
  s3?: number;
  /**
   * Only reaches `FsStorageProvider.deleteResources` — `delete` fans every path out at once
   * instead of chunking, so tiles deletion is unaffected by it.
   */
  fs?: number;
}

function buildProviders(minio: MinioHandle, fsBasePath: string, batchSizes: ProviderBatchSizes = {}): StorageProviders {
  const fsStorageConfig: FsStorageConfig = {
    basePath: fsBasePath,
    subPaths: [FS_ALLOWED_SUB_PATH],
    batchSize: batchSizes.fs ?? FS_DELETE_BATCH_SIZE,
  };
  const s3StorageConfig = buildS3StorageConfigForMinio(minio);

  return {
    [StorageProvider.S3]: new S3StorageProvider({ ...s3StorageConfig, batchSize: batchSizes.s3 ?? s3StorageConfig.batchSize }, createMockLogger()),
    [StorageProvider.FS]: new FsStorageProvider(fsStorageConfig, createMockLogger()),
  };
}

async function setupTestStorageContext({ minio, s3Client }: BackendHandles): Promise<TestStorageContext> {
  const bucket = `test-${faker.string.alphanumeric({ length: 16, casing: 'lower' })}`;
  await ensureBucket(s3Client, bucket);
  const fsBasePath = await makeTempFsBase();

  return { providers: buildProviders(minio, fsBasePath), bucket, fsBasePath, fsSubPath: FS_ALLOWED_SUB_PATH };
}

/**
 * Rebuilds the current context's providers with different delete batch sizes, so a test can
 * cross a provider's own chunking boundary without seeding thousands of tiles. The returned
 * providers point at the same bucket and base path, so seeding stays unchanged.
 */
function providersWithBatchSizes(handles: BackendHandles, storageContext: TestStorageContext, batchSizes: ProviderBatchSizes): StorageProviders {
  return buildProviders(handles.minio, storageContext.fsBasePath, batchSizes);
}

async function teardownTestStorageContext(handles: BackendHandles, storageContext: TestStorageContext): Promise<void> {
  try {
    await Promise.all([deleteBucket(handles.s3Client, storageContext.bucket), rmBase(storageContext.fsBasePath)]);
  } finally {
    container.reset();
  }
}

interface ProviderBackend {
  storageProvider: PathAddressedProvider;
  /**
   * Task params carrying this backend's own storage locator — bucket for S3, sub path for FS.
   * `overrides` pins the otherwise-faked tile fields, e.g. explicit `ranges`.
   */
  buildParams: (tilesRelativePath: string, overrides?: Partial<TilesDeletionCommon>) => PathAddressedParams;
  /** Seeds tiles at paths relative to the storage target. */
  seed: (paths: string[]) => Promise<void>;
  /** Lists surviving tiles as paths relative to the storage target. */
  list: (prefix: string) => Promise<string[]>;
}

function s3Backend(handles: () => BackendHandles, perTest: () => TestStorageContext): ProviderBackend {
  return {
    storageProvider: StorageProvider.S3,
    buildParams: (tilesRelativePath, overrides) => buildS3TilesDeletionParams({ ...overrides, bucket: perTest().bucket, tilesRelativePath }),
    seed: async (paths) => putManyTiles(handles().s3Client, perTest().bucket, paths),
    list: async (prefix) => listAllKeys(handles().s3Client, perTest().bucket, prefix),
  };
}

function fsBackend(perTest: () => TestStorageContext): ProviderBackend {
  // The provider joins base path + sub path itself, so the test seeds and reads the same root.
  const targetRoot = (): string => join(perTest().fsBasePath, perTest().fsSubPath);
  return {
    storageProvider: StorageProvider.FS,
    buildParams: (tilesRelativePath, overrides) => buildFsTilesDeletionParams({ ...overrides, subPath: perTest().fsSubPath, tilesRelativePath }),
    seed: async (paths) => writeManyTiles(targetRoot(), paths),
    list: async (prefix) => (await listAllFiles(targetRoot())).filter((path) => path.startsWith(prefix)),
  };
}

export {
  FS_ALLOWED_SUB_PATH,
  startBackends,
  stopBackends,
  setupTestStorageContext,
  teardownTestStorageContext,
  providersWithBatchSizes,
  s3Backend,
  fsBackend,
};
export type { BackendHandles, TestStorageContext, ProviderBackend, PathAddressedParams, ProviderBatchSizes };
