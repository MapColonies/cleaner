/* eslint-disable @typescript-eslint/naming-convention */
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  NoSuchBucket,
  NotFound,
  paginateListObjectsV2,
  S3Client,
  S3ServiceException,
  type DeleteObjectsCommandOutput,
} from '@aws-sdk/client-s3';
import { faker } from '@faker-js/faker';
import type { Logger } from '@map-colonies/js-logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from '@src/cleaner/errors';
import { S3StorageProvider } from '@src/cleaner/storageProviders/s3StorageProvider';
import { createMockLogger, createS3StorageConfig, S3_VALIDATED_CONFIG_DEFAULTS } from '../helpers/mocks';

const mockSend = vi.fn();
const mockPaginateListObjectsV2Next = vi.fn();
const mockPaginateListObjectsV2Return = vi.fn();
const mockPaginateListObjectsV2Throw = vi.fn();
const mockPaginateListObjectsV2Iterator = vi.fn().mockReturnValue({
  next: mockPaginateListObjectsV2Next,
  return: mockPaginateListObjectsV2Return,
  throw: mockPaginateListObjectsV2Throw,
});
const mockPaginateListObjectsV2 = {
  [Symbol.asyncIterator]: mockPaginateListObjectsV2Iterator,
};

vi.mock(import('@aws-sdk/client-s3'), async (importOriginal) => {
  const originModule = await importOriginal();
  return {
    ...originModule,
    S3Client: vi.fn(() => ({ send: mockSend })) as unknown as typeof S3Client,
    DeleteObjectsCommand: vi.fn((input: unknown) => input) as unknown as typeof DeleteObjectsCommand,
    ListObjectsV2Command: vi.fn((input: unknown) => input) as unknown as typeof ListObjectsV2Command,
    paginateListObjectsV2: vi.fn(() => mockPaginateListObjectsV2) as unknown as typeof paginateListObjectsV2,
  };
});

const BUCKET = 'test-bucket';

describe('S3StorageProvider', () => {
  let provider: S3StorageProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    provider = new S3StorageProvider(createS3StorageConfig(), mockLogger);
  });

  describe('#constructor', () => {
    it('should construct S3Client with config values', () => {
      const provider = new S3StorageProvider(createS3StorageConfig(), mockLogger);
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: {
            accessKeyId: S3_VALIDATED_CONFIG_DEFAULTS.accessKeyId,
            secretAccessKey: S3_VALIDATED_CONFIG_DEFAULTS.secretAccessKey,
          },
          endpoint: S3_VALIDATED_CONFIG_DEFAULTS.endpoint,
          forcePathStyle: S3_VALIDATED_CONFIG_DEFAULTS.forcePathStyle,
          region: S3_VALIDATED_CONFIG_DEFAULTS.region,
          tls: S3_VALIDATED_CONFIG_DEFAULTS.sslEnabled,
        })
      );
      expect(provider).toBeInstanceOf(S3StorageProvider);
    });
  });

  describe('#delete', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({ Errors: [] });
    });

    it('should return empty failures map for empty input', async () => {
      const result = await provider.delete([], BUCKET);
      expect(result).toEqual({ failures: new Map() });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should send DeleteObjectsCommand with correct keys', async () => {
      const paths = ['folder/a.txt', 'folder/b.txt'];

      await provider.delete(paths, BUCKET);

      expect(DeleteObjectsCommand).toHaveBeenCalledWith({
        Bucket: BUCKET,
        Delete: { Objects: [{ Key: 'folder/a.txt' }, { Key: 'folder/b.txt' }] },
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return empty failures map when all deletes succeed', async () => {
      const paths = ['a.txt', 'b.txt'];

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual({ failures: new Map() });
    });

    it('should return failed paths tagged with the S3 error Code', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Key: 'a.txt', Code: 'AccessDenied', Message: 'Forbidden' }],
      });
      const paths = ['a.txt', 'b.txt'];

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual({ failures: new Map([['AccessDenied', { count: 1, sample: 'a.txt' }]]) });
    });

    it('should treat NoSuchKey as a failed deletion tagged with NoSuchKey reason', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Key: 'missing.txt', Code: 'NoSuchKey', Message: 'Not Found' }],
      });
      const paths = ['missing.txt'];

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual({ failures: new Map([['NoSuchKey', { count: 1, sample: 'missing.txt' }]]) });
    });

    it('should fall back to Message when error has no Code', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Key: 'a.txt', Message: 'Something bad' }],
      });

      const result = await provider.delete(['a.txt'], BUCKET);

      expect(result).toEqual({ failures: new Map([['Something bad', { count: 1, sample: 'a.txt' }]]) });
    });

    it('should fall back to "Unknown" when error has neither Code nor Message', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Key: 'a.txt' }],
      });

      const result = await provider.delete(['a.txt'], BUCKET);

      expect(result).toEqual({ failures: new Map([['Unknown', { count: 1, sample: 'a.txt' }]]) });
    });

    it('should return all errors including NoSuchKey with their codes', async () => {
      mockSend.mockResolvedValue({
        Errors: [
          { Key: 'a.txt', Code: 'NoSuchKey' },
          { Key: 'b.txt', Code: 'AccessDenied' },
          { Key: 'c.txt', Code: 'NoSuchKey' },
          { Key: 'd.txt', Code: 'InternalError' },
        ],
      });

      const result = await provider.delete(['a.txt', 'b.txt', 'c.txt', 'd.txt'], BUCKET);

      expect(result).toEqual({
        failures: new Map([
          ['NoSuchKey', { count: 2, sample: 'a.txt' }],
          ['AccessDenied', { count: 1, sample: 'b.txt' }],
          ['InternalError', { count: 1, sample: 'd.txt' }],
        ]),
      });
    });

    it('should batch paths into chunks of the configured batch size', async () => {
      const paths = Array.from({ length: 1500 }, (_, i) => `object-${i}.txt`);
      provider = new S3StorageProvider(createS3StorageConfig({ batchSize: 1000 }), mockLogger);

      await provider.delete(paths, BUCKET);

      expect(mockSend).toHaveBeenCalledTimes(2);
      const firstCallInput = vi.mocked(DeleteObjectsCommand).mock.calls[0]![0] as {
        Delete: { Objects: { Key: string }[] };
      };
      const secondCallInput = vi.mocked(DeleteObjectsCommand).mock.calls[1]![0] as {
        Delete: { Objects: { Key: string }[] };
      };
      expect(firstCallInput.Delete.Objects).toHaveLength(1000);
      expect(secondCallInput.Delete.Objects).toHaveLength(500);
    });

    it('should never exceed the S3 max keys limit per request for the maximum allowed batch size', async () => {
      const paths = Array.from({ length: 2500 }, (_, i) => `object-${i}.txt`);
      provider = new S3StorageProvider(createS3StorageConfig({ batchSize: 1000 }), mockLogger);

      await provider.delete(paths, BUCKET);

      expect(mockSend).toHaveBeenCalledTimes(3);
      const callInputs = vi.mocked(DeleteObjectsCommand).mock.calls.map((call) => call[0] as { Delete: { Objects: { Key: string }[] } });
      expect(callInputs.every((input) => input.Delete.Objects.length <= 1000)).toBe(true);
      expect(callInputs.map((input) => input.Delete.Objects.length)).toEqual([1000, 1000, 500]);
    });

    it('should accumulate failures across multiple chunks', async () => {
      const paths = Array.from({ length: 1500 }, (_, i) => `object-${i}.txt`);
      mockSend
        .mockResolvedValueOnce({ Errors: [{ Key: 'object-0.txt', Code: 'AccessDenied' }] })
        .mockResolvedValueOnce({ Errors: [{ Key: 'object-1000.txt', Code: 'AccessDenied' }] });

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual({ failures: new Map([['AccessDenied', { count: 2, sample: 'object-0.txt' }]]) });
    });

    it('should ignore returned errors that carry no Key', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Code: 'InternalError' }, { Key: 'b.txt', Code: 'AccessDenied' }],
      });

      const result = await provider.delete(['a.txt', 'b.txt'], BUCKET);

      expect(result).toEqual({ failures: new Map([['AccessDenied', { count: 1, sample: 'b.txt' }]]) });
    });

    it('should return an empty failures map when every returned error carries no Key', async () => {
      mockSend.mockResolvedValue({ Errors: [{ Code: 'InternalError' }] });

      const result = await provider.delete(['a.txt'], BUCKET);

      expect(result).toEqual({ failures: new Map() });
    });

    it('should tag the chunk with the stringified value when send rejects with a non-Error', async () => {
      mockSend.mockRejectedValue('connection reset');

      const result = await provider.delete(['a.txt', 'b.txt'], BUCKET);

      expect(result).toEqual({ failures: new Map([['connection reset', { count: 2, sample: 'a.txt' }]]) });
    });

    it('should add entire chunk to failures tagged with the thrown error when send rejects', async () => {
      mockSend.mockRejectedValue(new Error('Network error'));
      const paths = ['a.txt', 'b.txt'];

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual({ failures: new Map([['Network error', { count: 2, sample: 'a.txt' }]]) });
    });
  });

  describe('#targetExists', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({ Errors: [] });
    });

    const PREFIX = 'some/prefix';

    it('should list objects with bucket and relativePath prefix', async () => {
      mockSend.mockResolvedValue({ KeyCount: 1 });

      const result = await provider.targetExists(BUCKET, PREFIX);

      expect(result).toBe(true);
      expect(ListObjectsV2Command).toHaveBeenCalledWith({ Bucket: BUCKET, Prefix: `${PREFIX}/`, MaxKeys: 1 });
    });

    it('should return false when no objects exist under the prefix', async () => {
      mockSend.mockResolvedValue({ KeyCount: 0 });

      const result = await provider.targetExists(BUCKET, PREFIX);

      expect(result).toBe(false);
    });

    it('should return false when KeyCount is undefined', async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.targetExists(BUCKET, PREFIX);

      expect(result).toBe(false);
    });

    it('should not double-add trailing slash when relativePath already ends with one', async () => {
      mockSend.mockResolvedValue({ KeyCount: 1 });

      await provider.targetExists(BUCKET, `${PREFIX}/`);

      expect(ListObjectsV2Command).toHaveBeenCalledWith({ Bucket: BUCKET, Prefix: `${PREFIX}/`, MaxKeys: 1 });
    });

    it('should return false when bucket does not exist (NoSuchBucket)', async () => {
      mockSend.mockRejectedValue(new NoSuchBucket({ message: 'Bucket not found', $metadata: { httpStatusCode: 404 } }));

      const result = await provider.targetExists(BUCKET, PREFIX);

      expect(result).toBe(false);
    });

    it('should re-throw errors that are not NoSuchBucket', async () => {
      mockSend.mockRejectedValue(new Error('NetworkError'));

      await expect(provider.targetExists(BUCKET, PREFIX)).rejects.toThrow('NetworkError');
    });
  });

  describe('#deleteResources', () => {
    const PATH = 'layer/v1';
    const NORMALIZED_PATH = `${PATH}/`;

    it('should return empty result when input paths is empty', async () => {
      const result = await provider.deleteResources({ paths: [], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(0);
    });

    it('should return empty result when listing returns no keys', async () => {
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found
      mockPaginateListObjectsV2Next.mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(1);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should not double-add trailing slash when prefix already ends with one', async () => {
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found
      mockPaginateListObjectsV2Next.mockResolvedValueOnce({ done: true, value: undefined });

      await provider.deleteResources({ paths: [`${PATH}/`], bucket: BUCKET, storageProvider: 'S3' });

      expect(paginateListObjectsV2).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ Prefix: NORMALIZED_PATH }));
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(1);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should list and delete a single object', async () => {
      const path = 'layer/v1/0/0.png';
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found for single object
      mockPaginateListObjectsV2Next.mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [path], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(1);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should list and delete a single page of objects', async () => {
      const keys = ['layer/v1/0/0.png', 'layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ Errors: [] }); // delete page 1
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(2);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should list and delete a single page of objects - no matching single object (bucket does not exists)', async () => {
      const keys = ['layer/v1/0/0.png', 'layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NoSuchBucket({ $metadata: {}, message: 'no bucket' })) // no bucket found for single object
        .mockResolvedValueOnce({ Errors: [] }); // delete page 1
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(2);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should list and delete multiple pages of objects', async () => {
      const page1Keys = ['layer/v1/0/0.png'];
      const page2Keys = ['layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ Errors: [] }) // delete page 1
        .mockResolvedValueOnce({ Errors: [] }); // delete page 2
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: page1Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: false, value: { Contents: page2Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(3);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it('should list and delete multiple pages of objects skipping deletion of empty keys', async () => {
      const page1Keys = ['layer/v1/0/0.png'];
      const page2Keys = ['layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ Errors: [] }); // delete page 2
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: page1Keys.map(() => ({ Key: undefined })) } })
        .mockResolvedValueOnce({ done: false, value: { Contents: page2Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(3);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should list and delete while skipping a single object deletion of a similar key', async () => {
      const objectKey = 'layer/v1/0/0.png';
      const page1Keys = [`${objectKey}8`];
      const page2Keys = [objectKey];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ Errors: [] }); // delete page 2
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: page1Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: false, value: { Contents: page2Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [objectKey], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(3);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should list and delete multiple paths and their objects', async () => {
      const PATH1 = 'layer/v1';
      const PATH2 = 'layer/v2';
      const path1Page1Keys = ['layer/v1/0/0.png'];
      const path1Page2Keys = ['layer/v1/0/1.png'];
      const path2Page1Keys = ['layer/v2/0/0.png'];
      const path2Page2Keys = ['layer/v2/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object for path 1
        .mockResolvedValueOnce({ Errors: [] }) // delete path 1 page 1
        .mockResolvedValueOnce({ Errors: [] }) // delete path 1 page 2
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object for path 2
        .mockResolvedValueOnce({ Errors: [] }) // delete path 2 page 1
        .mockResolvedValueOnce({ Errors: [] }); // delete path 2 page 2
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: path1Page1Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: false, value: { Contents: path1Page2Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined })
        .mockResolvedValueOnce({ done: false, value: { Contents: path2Page1Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: false, value: { Contents: path2Page2Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH1, PATH2], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(6);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(7);
    });

    it('should list and delete a single object and matching paths and their objects', async () => {
      const keys = ['layer/v1/0/0.png', 'layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockResolvedValueOnce(undefined) // single object exists
        .mockResolvedValueOnce({ Errors: [] }) // delete single object
        .mockResolvedValueOnce({ Errors: [] }); // delete page 1
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(2);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it('should handle empty page Contents response', async () => {
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found
      mockPaginateListObjectsV2Next.mockResolvedValueOnce({ done: false, value: {} }).mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(2);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle a page that reports its KeyCount', async () => {
      const keys = ['layer/v1/0/0.png', 'layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ Errors: [] }); // delete page 1
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { KeyCount: keys.length, Contents: keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(DeleteObjectsCommand).toHaveBeenCalledWith({ Bucket: BUCKET, Delete: { Objects: keys.map((Key) => ({ Key })) } });
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should skip an entire page whose keys all belong to a sibling sharing the prefix', async () => {
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found for single object
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: [{ Key: 'layer/v10/0/0.png' }, { Key: 'layer/v1x/0/0.png' }] } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(DeleteObjectsCommand).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should accumulate failures of the same reason across pages keeping the first sample', async () => {
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ Errors: [{ Key: 'layer/v1/0/0.png', Code: 'AccessDenied' }] }) // delete page 1
        .mockResolvedValueOnce({ Errors: [{ Key: 'layer/v1/0/1.png', Code: 'AccessDenied' }] }); // delete page 2
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: [{ Key: 'layer/v1/0/0.png' }] } })
        .mockResolvedValueOnce({ done: false, value: { Contents: [{ Key: 'layer/v1/0/1.png' }] } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map([['AccessDenied', { count: 2, sample: 'layer/v1/0/0.png' }]]) });
    });

    it('should accumulate failures of the same reason across paths keeping the first sample', async () => {
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for path 1
        .mockResolvedValueOnce({ Errors: [{ Key: 'layer/v1/0/0.png', Code: 'AccessDenied' }] }) // delete path 1 page 1
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for path 2
        .mockResolvedValueOnce({ Errors: [{ Key: 'layer/v2/0/0.png', Code: 'AccessDenied' }] }); // delete path 2 page 1
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: [{ Key: 'layer/v1/0/0.png' }] } })
        .mockResolvedValueOnce({ done: true, value: undefined })
        .mockResolvedValueOnce({ done: false, value: { Contents: [{ Key: 'layer/v2/0/0.png' }] } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: ['layer/v1', 'layer/v2'], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map([['AccessDenied', { count: 2, sample: 'layer/v1/0/0.png' }]]) });
    });

    it('should request pages sized by the configured batch size', async () => {
      provider = new S3StorageProvider(createS3StorageConfig({ batchSize: 500 }), mockLogger);
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found for single object
      mockPaginateListObjectsV2Next.mockResolvedValueOnce({ done: true, value: undefined });

      await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(paginateListObjectsV2).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 500 }), expect.anything());
    });

    it('should handle empty delete page Errors response', async () => {
      const keys = ['layer/v1/0/0.png', 'layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ $metadata: {} } satisfies DeleteObjectsCommandOutput); // delete page 1
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(2);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should handle delete page Errors response without elements', async () => {
      const keys = ['layer/v1/0/0.png', 'layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ $metadata: {}, Errors: [] } satisfies DeleteObjectsCommandOutput); // delete page 1
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map() });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(2);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should throw UnrecoverableError when bucket does not exist', async () => {
      mockSend.mockRejectedValueOnce(new NotFound({ $metadata: {}, message: '' }));

      const result = provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw an error when storage existence check failing', async () => {
      const expectedError = new Error('error');
      mockSend.mockRejectedValueOnce(expectedError);

      const result = provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      await expect(result).rejects.toThrow(expectedError);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw UnrecoverableError when a path is empty (root deletion guard)', async () => {
      const result = provider.deleteResources({ paths: [''], bucket: BUCKET, storageProvider: 'S3' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(paginateListObjectsV2).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledTimes(0);
    });

    it('should throw UnrecoverableError when any path is empty even if others are valid', async () => {
      const result = provider.deleteResources({ paths: [PATH, ''], bucket: BUCKET, storageProvider: 'S3' });

      await expect(result).rejects.toThrow(UnrecoverableError);
      expect(mockSend).toHaveBeenCalledTimes(0);
    });

    it('should throw an error when checking for matching single object is failing (generic error)', async () => {
      const expectedError = new Error('NetworkError');
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(expectedError); // error thrown for single object lookup

      const result = provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      await expect(result).rejects.toThrow(expectedError);
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should paginate and return all delete errors returned by S3 per object', async () => {
      const page1Keys = ['layer/v1/0/0.png'];
      const page2Keys = ['layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockResolvedValueOnce({ Errors: [{ Key: 'layer/v1/0/0.png', Code: 'AccessDenied' }] }) // delete page 1
        .mockResolvedValueOnce({ Errors: [] }); // delete page 2
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: page1Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: false, value: { Contents: page2Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map([['AccessDenied', { count: 1, sample: 'layer/v1/0/0.png' }]]) });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(3);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it('should paginate and return all delete errors thrown and unhandled by S3', async () => {
      const page1Keys = ['layer/v1/0/0.png'];
      const page2Keys = ['layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })) // no listing found for single object
        .mockRejectedValueOnce(new Error('NetworkError')) // delete page 1
        .mockResolvedValueOnce({ Errors: [] }); // delete page 2
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: page1Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: false, value: { Contents: page2Keys.map((Key) => ({ Key })) } })
        .mockResolvedValueOnce({ done: true, value: undefined });

      const result = await provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      expect(result).toEqual({ failures: new Map([['NetworkError', { count: 1, sample: 'layer/v1/0/0.png' }]]) });
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(3);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it('should stop pagination and throw an error when bucket does not exist', async () => {
      const expectedError = new NoSuchBucket({ $metadata: { requestId: faker.string.uuid() }, message: 'msg' });
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found for single object
      mockPaginateListObjectsV2Next.mockRejectedValueOnce(expectedError);

      const result = provider.deleteResources({ paths: [PATH], bucket: '', storageProvider: 'S3' });

      await expect(result).rejects.toThrow(expectedError);
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(1);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should stop pagination and throw an error when S3 throws a service error', async () => {
      const expectedError = new S3ServiceException({ $fault: 'server', $metadata: { requestId: faker.string.uuid() }, name: 'msg' });
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found for single object
      mockPaginateListObjectsV2Next.mockRejectedValueOnce(expectedError);

      const result = provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      await expect(result).rejects.toThrow(expectedError);
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(1);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should stop pagination and throw an error when S3 throws a bucket does not exists error', async () => {
      const expectedError = new NoSuchBucket({ $metadata: {}, message: '' });
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found for single object
      mockPaginateListObjectsV2Next.mockRejectedValueOnce(expectedError);

      const result = provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      await expect(result).rejects.toThrow(expectedError);
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(1);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should stop pagination and return failure when list call throws', async () => {
      const expectedError = new Error('NetworkError');
      const keys = ['layer/v1/0/0.png', 'layer/v1/0/1.png'];
      mockSend
        .mockResolvedValueOnce(undefined) // bucket exists
        .mockRejectedValueOnce(new NotFound({ $metadata: {}, message: 'not found' })); // no listing found for single object
      mockPaginateListObjectsV2Next
        .mockResolvedValueOnce({ done: false, value: { Contents: keys.map((Key) => ({ Key })) } })
        .mockRejectedValueOnce(expectedError);

      const result = provider.deleteResources({ paths: [PATH], bucket: BUCKET, storageProvider: 'S3' });

      await expect(result).rejects.toThrow(expectedError);
      expect(mockPaginateListObjectsV2Next).toHaveBeenCalledTimes(2);
      expect(mockPaginateListObjectsV2Return).toHaveBeenCalledTimes(0);
      expect(mockPaginateListObjectsV2Throw).toHaveBeenCalledTimes(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });
  });
});
