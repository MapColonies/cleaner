import { faker } from '@faker-js/faker';
import { container } from 'tsyringe';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { StorageProvider } from '@map-colonies/raster-shared';
import type { S3Client } from '@aws-sdk/client-s3';
// eslint-disable-next-line @typescript-eslint/naming-convention -- ioredis' default export is a class
import type Redis from 'ioredis';
import {
  createRedisConnection,
  FsStorageProvider,
  RedisStorageProvider,
  S3StorageProvider,
  type FsStorageConfig,
  type RedisStorageConfig,
  type StorageProviders,
} from '@src/cleaner/storageProviders';
import { createMockLogger } from '../../helpers/mocks';
import { startMinio, type MinioHandle } from './minioContainer';
import { buildS3StorageConfigForMinio, createTestS3Client, deleteBucket, ensureBucket } from './s3TestKit';
import { makeTempFsBase, rmBase } from './fsTestKit';
import { startRedis, type RedisHandle } from './redisContainer';
import { createTestRedisClient, flush } from './redisTestKit';

/**
 * The only sub path FS deletion is allowed under, mirroring `storage.fs.subPaths` in config.
 * The task's own `subPath` must live inside it or `FsStorageProvider` rejects the paths outright.
 */
const FS_ALLOWED_SUB_PATH = 'artifacts/tiles';
const FS_DELETE_BATCH_SIZE = 100;
// Small paging values so a modest seed crosses both SCAN and UNLINK boundaries
const REDIS_SCAN_COUNT = 10;
const REDIS_DELETE_BATCH_SIZE = 4;

interface BackendHandles {
  minio: MinioHandle;
  s3Client: S3Client;
  redis: RedisHandle;
  /** Seeding and listing client; the provider gets its own connection. */
  redisClient: Redis;
  redisConnection: Redis;
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

function buildRedisStorageConfig(redis: RedisHandle, batchSize = REDIS_DELETE_BATCH_SIZE): RedisStorageConfig {
  return { host: redis.host, port: redis.port, db: 0, scanCount: REDIS_SCAN_COUNT, batchSize };
}

async function startBackends(): Promise<BackendHandles> {
  const [minio, redis] = await Promise.all([startMinio(), startRedis()]);
  const s3Client = createTestS3Client(minio);
  const redisClient = createTestRedisClient(redis);
  const redisConnection = await createRedisConnection(buildRedisStorageConfig(redis), createMockLogger());
  return { minio, s3Client, redis, redisClient, redisConnection };
}

async function stopBackends({ minio, s3Client, redis, redisClient, redisConnection }: BackendHandles): Promise<void> {
  s3Client.destroy();
  await redisConnection.quit();
  redisClient.disconnect();
  await Promise.all([minio.stop(), redis.stop()]);
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
  /** Keys per `UNLINK` the Redis provider chunks its input into. */
  redis?: number;
}

function buildProviders(
  { minio, redis, redisConnection }: BackendHandles,
  fsBasePath: string,
  batchSizes: ProviderBatchSizes = {}
): StorageProviders {
  const fsStorageConfig: FsStorageConfig = {
    basePath: fsBasePath,
    subPaths: [FS_ALLOWED_SUB_PATH],
    batchSize: batchSizes.fs ?? FS_DELETE_BATCH_SIZE,
  };
  const s3StorageConfig = buildS3StorageConfigForMinio(minio);

  return {
    [StorageProvider.S3]: new S3StorageProvider({ ...s3StorageConfig, batchSize: batchSizes.s3 ?? s3StorageConfig.batchSize }, createMockLogger()),
    [StorageProvider.FS]: new FsStorageProvider(fsStorageConfig, createMockLogger()),
    [StorageProvider.REDIS]: new RedisStorageProvider(buildRedisStorageConfig(redis, batchSizes.redis), redisConnection, createMockLogger()),
  };
}

async function setupTestStorageContext(handles: BackendHandles): Promise<TestStorageContext> {
  const bucket = `test-${faker.string.alphanumeric({ length: 16, casing: 'lower' })}`;
  await ensureBucket(handles.s3Client, bucket);
  const fsBasePath = await makeTempFsBase();

  return { providers: buildProviders(handles, fsBasePath), bucket, fsBasePath, fsSubPath: FS_ALLOWED_SUB_PATH };
}

/**
 * Rebuilds the current context's providers with different delete batch sizes, so a test can
 * cross a provider's own chunking boundary without seeding thousands of tiles. The returned
 * providers point at the same bucket and base path, so seeding stays unchanged.
 */
function providersWithBatchSizes(handles: BackendHandles, storageContext: TestStorageContext, batchSizes: ProviderBatchSizes): StorageProviders {
  return buildProviders(handles, storageContext.fsBasePath, batchSizes);
}

async function teardownTestStorageContext(handles: BackendHandles, storageContext: TestStorageContext): Promise<void> {
  try {
    await Promise.all([deleteBucket(handles.s3Client, storageContext.bucket), rmBase(storageContext.fsBasePath), flush(handles.redisClient)]);
  } finally {
    // The poller helpers register into the global container; start every test from a clean one.
    container.reset();
  }
}

/** Lazy views over the suite's backends, safe to capture at `describe.each` collection time. */
interface StorageBackendsHarness {
  handles: () => BackendHandles;
  storageContext: () => TestStorageContext;
}

/**
 * Registers the whole backend lifecycle for a suite: containers once per file, a fresh bucket,
 * FS base path and empty Redis DB per test. Call inside the top-level `describe`.
 */
function useStorageBackends(): StorageBackendsHarness {
  let handles: BackendHandles;
  let storageContext: TestStorageContext;

  beforeAll(async () => {
    handles = await startBackends();
  });

  afterAll(async () => {
    await stopBackends(handles);
  });

  beforeEach(async () => {
    storageContext = await setupTestStorageContext(handles);
  });

  afterEach(async () => {
    await teardownTestStorageContext(handles, storageContext);
  });

  return { handles: () => handles, storageContext: () => storageContext };
}

export { FS_ALLOWED_SUB_PATH, useStorageBackends, providersWithBatchSizes };
export type { BackendHandles, TestStorageContext, ProviderBatchSizes, StorageBackendsHarness };
