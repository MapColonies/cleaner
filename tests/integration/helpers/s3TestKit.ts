/* eslint-disable @typescript-eslint/naming-convention */
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  BucketAlreadyOwnedByYou,
  BucketAlreadyExists,
} from '@aws-sdk/client-s3';
import { S3_MAX_DELETE_BATCH } from '@src/cleaner/storageProviders/s3StorageProvider';
import type { MinioHandle } from './minioContainer';
import { TINY_TILE_BODY } from './tileFixtures';

function createTestS3Client(handle: MinioHandle): S3Client {
  return new S3Client({
    endpoint: handle.endpoint,
    credentials: {
      accessKeyId: handle.accessKeyId,
      secretAccessKey: handle.secretAccessKey,
    },
    region: 'us-east-1',
    forcePathStyle: true,
    tls: false,
  });
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (err instanceof BucketAlreadyOwnedByYou || err instanceof BucketAlreadyExists) {
      return;
    }
    throw err;
  }
}

async function listAllKeys(client: S3Client, bucket: string, prefix?: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    for (const obj of response.Contents ?? []) {
      if (obj.Key !== undefined) {
        keys.push(obj.Key);
      }
    }
    continuationToken = response.IsTruncated === true ? response.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);
  return keys.sort();
}

async function emptyBucket(client: S3Client, bucket: string): Promise<void> {
  const keys = await listAllKeys(client, bucket);
  for (let i = 0; i < keys.length; i += S3_MAX_DELETE_BATCH) {
    const chunk = keys.slice(i, i + S3_MAX_DELETE_BATCH);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })) },
      })
    );
  }
}

async function deleteBucket(client: S3Client, bucket: string): Promise<void> {
  await emptyBucket(client, bucket);
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
}

async function putTile(client: S3Client, bucket: string, key: string): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: TINY_TILE_BODY }));
}

async function putManyTiles(client: S3Client, bucket: string, keys: string[]): Promise<void> {
  const concurrency = 20;
  for (let i = 0; i < keys.length; i += concurrency) {
    await Promise.all(keys.slice(i, i + concurrency).map(async (key) => putTile(client, bucket, key)));
  }
}

export { createTestS3Client, ensureBucket, deleteBucket, emptyBucket, putTile, putManyTiles, listAllKeys };
