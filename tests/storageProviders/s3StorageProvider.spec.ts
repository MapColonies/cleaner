/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command, NoSuchBucket } from '@aws-sdk/client-s3';
import { S3StorageProvider } from '@src/cleaner/storageProviders/s3StorageProvider';
import { createMockLogger, createMockS3Config, S3_STORAGE_CONFIG_DEFAULTS } from '../helpers/mocks';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class NoSuchBucket extends Error {
    public constructor() {
      super('NoSuchBucket');
      this.name = 'NoSuchBucket';
    }
  }
  return {
    S3Client: vi.fn(() => ({ send: mockSend })),
    DeleteObjectsCommand: vi.fn((input: unknown) => input),
    ListObjectsV2Command: vi.fn((input: unknown) => input),
    NoSuchBucket,
  };
});

const BUCKET = 'test-bucket';

describe('S3StorageProvider', () => {
  let provider: S3StorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ Errors: [] });
    provider = new S3StorageProvider(createMockS3Config(), createMockLogger());
  });

  describe('delete', () => {
    it('should return empty array for empty input', async () => {
      const result = await provider.delete([], BUCKET);
      expect(result).toEqual([]);
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

    it('should return empty array when all deletes succeed', async () => {
      const paths = ['a.txt', 'b.txt'];

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual([]);
    });

    it('should return failed paths tagged with the S3 error Code', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Key: 'a.txt', Code: 'AccessDenied', Message: 'Forbidden' }],
      });
      const paths = ['a.txt', 'b.txt'];

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual([{ path: 'a.txt', reason: 'AccessDenied' }]);
    });

    it('should treat NoSuchKey as a failed deletion tagged with NoSuchKey reason', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Key: 'missing.txt', Code: 'NoSuchKey', Message: 'Not Found' }],
      });
      const paths = ['missing.txt'];

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual([{ path: 'missing.txt', reason: 'NoSuchKey' }]);
    });

    it('should fall back to Message when error has no Code', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Key: 'a.txt', Message: 'Something bad' }],
      });

      const result = await provider.delete(['a.txt'], BUCKET);

      expect(result).toEqual([{ path: 'a.txt', reason: 'Something bad' }]);
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

      expect(result).toEqual([
        { path: 'a.txt', reason: 'NoSuchKey' },
        { path: 'b.txt', reason: 'AccessDenied' },
        { path: 'c.txt', reason: 'NoSuchKey' },
        { path: 'd.txt', reason: 'InternalError' },
      ]);
    });

    it('should batch paths into chunks of 1000 (S3 limit)', async () => {
      const paths = Array.from({ length: 1500 }, (_, i) => `object-${i}.txt`);

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

    it('should accumulate failures across multiple chunks', async () => {
      const paths = Array.from({ length: 1500 }, (_, i) => `object-${i}.txt`);
      mockSend
        .mockResolvedValueOnce({ Errors: [{ Key: 'object-0.txt', Code: 'AccessDenied' }] })
        .mockResolvedValueOnce({ Errors: [{ Key: 'object-1000.txt', Code: 'AccessDenied' }] });

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual([
        { path: 'object-0.txt', reason: 'AccessDenied' },
        { path: 'object-1000.txt', reason: 'AccessDenied' },
      ]);
    });

    it('should add entire chunk to failures tagged with the thrown error when send rejects', async () => {
      mockSend.mockRejectedValue(new Error('Network error'));
      const paths = ['a.txt', 'b.txt'];

      const result = await provider.delete(paths, BUCKET);

      expect(result).toEqual([
        { path: 'a.txt', reason: 'Network error' },
        { path: 'b.txt', reason: 'Network error' },
      ]);
    });
  });

  describe('targetExists', () => {
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

  describe('constructor', () => {
    it('should construct S3Client with config values', () => {
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: S3_STORAGE_CONFIG_DEFAULTS.endpoint,
          forcePathStyle: S3_STORAGE_CONFIG_DEFAULTS.forcePathStyle,
          region: S3_STORAGE_CONFIG_DEFAULTS.region,
          tls: S3_STORAGE_CONFIG_DEFAULTS.sslEnabled,
        })
      );
    });
  });
});
