import { faker } from '@faker-js/faker';
import { container } from 'tsyringe';
import { SourceType } from '@map-colonies/raster-shared';
import type { S3Client } from '@aws-sdk/client-s3';
import { S3StorageProvider, FsStorageProvider, type IStorageProvider } from '@src/cleaner/storageProviders';
import { createMockLogger } from '../../helpers/mocks';
import { startMinio, type MinioHandle } from './minioContainer';
import { createTestS3Client, deleteBucket, ensureBucket, listAllKeys, putManyTiles } from './s3TestKit';
import { listAllFiles, makeTempFsBase, rmBase, writeManyTiles } from './fsTestKit';
import { buildS3ConfigForMinio } from './testPoller';

type ProviderType = Exclude<SourceType, 'GPKG'>;

interface BackendHandles {
  minio: MinioHandle;
  s3Client: S3Client;
}

interface TestStorageContext {
  providers: Map<ProviderType, IStorageProvider>;
  bucket: string;
  fsBase: string;
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

async function setupTestStorageContext({ minio, s3Client }: BackendHandles): Promise<TestStorageContext> {
  const bucket = `test-${faker.string.alphanumeric({ length: 16, casing: 'lower' })}`;
  await ensureBucket(s3Client, bucket);
  const fsBase = await makeTempFsBase();

  const providers = new Map<ProviderType, IStorageProvider>([
    [SourceType.S3, new S3StorageProvider(buildS3ConfigForMinio(minio), createMockLogger())],
    [SourceType.FS, new FsStorageProvider(createMockLogger())],
  ]);

  return { providers, bucket, fsBase };
}

async function teardownTestStorageContext(handles: BackendHandles, storageContext: TestStorageContext): Promise<void> {
  try {
    await Promise.all([deleteBucket(handles.s3Client, storageContext.bucket), rmBase(storageContext.fsBase)]);
  } finally {
    container.reset();
  }
}
interface ProviderBackend {
  sourceProvider: ProviderType;
  seed: (paths: string[]) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
}

function s3Backend(handles: () => BackendHandles, perTest: () => TestStorageContext): ProviderBackend {
  return {
    sourceProvider: SourceType.S3,
    seed: async (paths) => putManyTiles(handles().s3Client, perTest().bucket, paths),
    list: async (prefix) => listAllKeys(handles().s3Client, perTest().bucket, prefix),
  };
}

function fsBackend(perTest: () => TestStorageContext): ProviderBackend {
  return {
    sourceProvider: SourceType.FS,
    seed: async (paths) => writeManyTiles(perTest().fsBase, paths),
    list: async (prefix) => (await listAllFiles(perTest().fsBase)).filter((p) => p.startsWith(prefix)),
  };
}

export { startBackends, stopBackends, setupTestStorageContext, teardownTestStorageContext, s3Backend, fsBackend };
export type { BackendHandles, TestStorageContext, ProviderBackend };
