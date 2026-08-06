import { faker } from '@faker-js/faker';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { type FsTilesDeletionParams, type S3TilesDeletionParams, SourceType } from '@map-colonies/raster-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoverableError, UnrecoverableError, ValidationError } from '@src/cleaner/errors';
import type { IStorageProvider, StorageProviders } from '@src/cleaner/storageProviders';
import type { TaskContext } from '@src/cleaner/strategies/strategyFactory';
import { TilesDeletionStrategy } from '@src/cleaner/strategies/tilesDeletionStrategy';
import { createMockLogger, createMockStorageProvider, createMockStrategyConfig } from '../helpers/mocks';

const S3_BUCKET = 'test-bucket';
const FS_SUB_PATH = 'artifacts/tiles';

const JOB_ID = faker.string.uuid();
const TASK_ID = faker.string.uuid();
const TASK_CONTEXT: TaskContext = { jobId: JOB_ID, taskId: TASK_ID, jobType: 'Ingestion_Update', taskType: 'tiles-deletion' };

const s3Params: S3TilesDeletionParams = {
  storageProvider: 'S3',
  bucket: S3_BUCKET,
  tilesRelativePath: 'layer/v1',
  fileExtension: 'png',
  ranges: [{ zoom: 10, minX: 0, maxX: 1, minY: 0, maxY: 1 }],
};

const fsParams: FsTilesDeletionParams = {
  storageProvider: 'FS',
  subPath: FS_SUB_PATH,
  tilesRelativePath: s3Params.tilesRelativePath,
  fileExtension: s3Params.fileExtension,
  ranges: s3Params.ranges,
};

// Builds an expected tile path under the standard tilesRelativePath/fileExtension.
const tilePath = (z: number, x: number, y: number): string => `${s3Params.tilesRelativePath}/${z}/${x}/${y}.${s3Params.fileExtension}`;

describe('TilesDeletionStrategy', () => {
  let strategy: TilesDeletionStrategy;
  let MockS3Provider: IStorageProvider<'S3'>;
  let MockFsProvider: IStorageProvider<'FS'>;
  let mockUpdateProgress: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MockS3Provider = createMockStorageProvider();
    MockFsProvider = createMockStorageProvider();
    mockUpdateProgress = vi.fn().mockResolvedValue(undefined);

    const storageProviders: StorageProviders = {
      [SourceType.FS]: MockFsProvider,
      [SourceType.S3]: MockS3Provider,
    };
    const queueClient = { updateProgress: mockUpdateProgress } as unknown as QueueClient;

    strategy = new TilesDeletionStrategy(createMockLogger(), createMockStrategyConfig(), storageProviders, queueClient, TASK_CONTEXT);
  });

  describe('#validate', () => {
    it('should validate and return S3 params', () => {
      expect(strategy.validate(s3Params)).toEqual(s3Params);
    });

    it('should validate and return FS params', () => {
      expect(strategy.validate(fsParams)).toEqual(fsParams);
    });

    it('should accept JPEG file extension', () => {
      const result = strategy.validate({ ...s3Params, fileExtension: 'jpeg' });
      expect(result).toMatchObject({ fileExtension: 'jpeg' });
    });

    it('should accept multiple ranges', () => {
      const ranges = [
        { zoom: 10, minX: 0, maxX: 5, minY: 0, maxY: 5 },
        { zoom: 11, minX: 0, maxX: 3, minY: 0, maxY: 3 },
      ];
      expect(strategy.validate({ ...s3Params, ranges })).toEqual({ ...s3Params, ranges });
    });

    it('should throw ValidationError when storageProvider is missing', () => {
      expect(() => strategy.validate({ ...s3Params, storageProvider: undefined })).toThrow(ValidationError);
    });

    it('should throw ValidationError for unsupported storageProvider value', () => {
      expect(() => strategy.validate({ ...s3Params, storageProvider: 'GCS' })).toThrow(ValidationError);
    });

    it('should throw ValidationError for empty ranges array', () => {
      expect(() => strategy.validate({ ...s3Params, ranges: [] })).toThrow(ValidationError);
    });

    it('should throw ValidationError for empty tilesRelativePath', () => {
      expect(() => strategy.validate({ ...s3Params, tilesRelativePath: '' })).toThrow(ValidationError);
    });

    it('should throw ValidationError when the S3 bucket is missing', () => {
      expect(() => strategy.validate({ ...s3Params, bucket: undefined })).toThrow(ValidationError);
    });

    it('should throw ValidationError when the FS subPath is missing', () => {
      expect(() => strategy.validate({ ...fsParams, subPath: undefined })).toThrow(ValidationError);
    });

    it('should throw ValidationError when params is null', () => {
      expect(() => strategy.validate(null)).toThrow(ValidationError);
    });
  });

  describe('#execute', () => {
    describe('target validation', () => {
      it('should throw UnrecoverableError when S3 storage target does not exist', async () => {
        vi.mocked(MockS3Provider.targetExists).mockResolvedValue(false);

        await expect(strategy.execute(s3Params)).rejects.toThrow(UnrecoverableError);
        expect(MockS3Provider.delete).not.toHaveBeenCalled();
      });

      it('should throw UnrecoverableError when FS storage target does not exist', async () => {
        vi.mocked(MockFsProvider.targetExists).mockResolvedValue(false);

        await expect(strategy.execute(fsParams)).rejects.toThrow(UnrecoverableError);
        expect(MockFsProvider.delete).not.toHaveBeenCalled();
      });

      it('should check targetExists with S3 bucket and tilesRelativePath as relativePath', async () => {
        await strategy.execute(s3Params);

        expect(MockS3Provider.targetExists).toHaveBeenCalledWith(S3_BUCKET, s3Params.tilesRelativePath);
      });

      it("should check targetExists with the task's own subPath and tilesRelativePath", async () => {
        await strategy.execute(fsParams);

        expect(MockFsProvider.targetExists).toHaveBeenCalledWith(FS_SUB_PATH, fsParams.tilesRelativePath);
      });

      it('should propagate an error thrown by the target existence check', async () => {
        const expectedError = new Error('EACCES');
        vi.mocked(MockS3Provider.targetExists).mockRejectedValue(expectedError);

        await expect(strategy.execute(s3Params)).rejects.toThrow(expectedError);
        expect(MockS3Provider.delete).not.toHaveBeenCalled();
      });
    });

    describe('provider routing', () => {
      it("should call S3 provider with the task's own bucket as storage target", async () => {
        const params: S3TilesDeletionParams = { ...s3Params, bucket: 'per-task-bucket' };

        await strategy.execute(params);

        expect(MockS3Provider.delete).toHaveBeenCalledWith(expect.any(Array), 'per-task-bucket');
        expect(MockFsProvider.delete).not.toHaveBeenCalled();
      });

      it("should call FS provider with the task's own subPath as storage target", async () => {
        await strategy.execute(fsParams);

        expect(MockFsProvider.delete).toHaveBeenCalledWith(expect.any(Array), FS_SUB_PATH);
        expect(MockS3Provider.delete).not.toHaveBeenCalled();
      });

      it('should pass the subPath through untouched rather than resolving it', async () => {
        const subPath = 'some/other/mount/point';

        await strategy.execute({ ...fsParams, subPath });

        expect(MockFsProvider.delete).toHaveBeenCalledWith(expect.any(Array), subPath);
      });

      it('should throw UnrecoverableError for REDIS params, whose tiles are not path addressed', async () => {
        const redisParams = { storageProvider: 'REDIS', prefix: 'layer-redis_WorldCRS84', ranges: s3Params.ranges };

        await expect(strategy.execute(strategy.validate(redisParams))).rejects.toThrow(UnrecoverableError);
        expect(MockS3Provider.delete).not.toHaveBeenCalled();
        expect(MockFsProvider.delete).not.toHaveBeenCalled();
      });

      it('should throw UnrecoverableError for unknown provider', async () => {
        const unknownParams = { ...s3Params, storageProvider: 'UNKNOWN' } as unknown as S3TilesDeletionParams;

        await expect(strategy.execute(unknownParams)).rejects.toThrow(UnrecoverableError);
      });

      it('should throw UnrecoverableError when the provider is registered but resolves to undefined', async () => {
        const storageProviders: StorageProviders = {
          [SourceType.FS]: MockFsProvider,
          [SourceType.S3]: undefined,
        };
        strategy = new TilesDeletionStrategy(
          createMockLogger(),
          createMockStrategyConfig(),
          storageProviders,
          { updateProgress: mockUpdateProgress } as unknown as QueueClient,
          TASK_CONTEXT
        );

        await expect(strategy.execute(s3Params)).rejects.toThrow(UnrecoverableError);
        expect(MockS3Provider.targetExists).not.toHaveBeenCalled();
        expect(MockS3Provider.delete).not.toHaveBeenCalled();
      });
    });

    describe('tile path generation', () => {
      it('should generate paths in z/x/y order with correct format', async () => {
        await strategy.execute(s3Params);

        // range: minX=0,maxX=1 minY=0,maxY=1 → 4 tiles, x iterates outer
        expect(MockS3Provider.delete).toHaveBeenCalledWith(
          [tilePath(10, 0, 0), tilePath(10, 0, 1), tilePath(10, 1, 0), tilePath(10, 1, 1)],
          S3_BUCKET
        );
      });

      it('should use the specified file extension', async () => {
        const params: S3TilesDeletionParams = { ...s3Params, fileExtension: 'jpeg' };

        await strategy.execute(params);

        const [paths] = vi.mocked(MockS3Provider.delete).mock.calls[0]!;
        expect(paths.every((p) => p.endsWith('.jpeg'))).toBe(true);
      });

      it('should concatenate tiles from multiple ranges', async () => {
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [
            { zoom: 5, minX: 0, maxX: 0, minY: 0, maxY: 0 },
            { zoom: 6, minX: 0, maxX: 0, minY: 0, maxY: 0 },
          ],
        };

        await strategy.execute(params);

        expect(MockS3Provider.delete).toHaveBeenCalledWith([tilePath(5, 0, 0), tilePath(6, 0, 0)], S3_BUCKET);
      });

      it('should offset x/y correctly when range does not start at 0', async () => {
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 7, minX: 3, maxX: 4, minY: 8, maxY: 9 }],
        };

        await strategy.execute(params);

        expect(MockS3Provider.delete).toHaveBeenCalledWith([tilePath(7, 3, 8), tilePath(7, 3, 9), tilePath(7, 4, 8), tilePath(7, 4, 9)], S3_BUCKET);
      });
    });

    describe('progress reporting', () => {
      it('should call updateProgress mid-stream for large tile sets without ever setting 100', async () => {
        // batchSize=100, concurrency=2 → flush after 200 tiles, then final flush for remainder
        // 14 * 15 = 210 tiles
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 13, minY: 0, maxY: 14 }],
        };

        await strategy.execute(params);

        expect(mockUpdateProgress).toHaveBeenCalledTimes(1);
        expect(mockUpdateProgress).not.toHaveBeenCalledWith(JOB_ID, TASK_ID, 100);
      });

      it('should report the percentage of tiles processed so far', async () => {
        // batchSize=100, concurrency=2 → flush + progress report after the first 200 of 210 tiles
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 13, minY: 0, maxY: 14 }],
        };

        await strategy.execute(params);

        expect(mockUpdateProgress).toHaveBeenCalledWith(JOB_ID, TASK_ID, Math.round((200 / 210) * 100));
      });

      it('should report progress once per completed concurrency window', async () => {
        // 420 tiles → two full windows of 200, then a trailing batch of 20
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 20, minY: 0, maxY: 19 }],
        };

        await strategy.execute(params);

        expect(mockUpdateProgress).toHaveBeenCalledTimes(2);
        expect(mockUpdateProgress).toHaveBeenNthCalledWith(1, JOB_ID, TASK_ID, Math.round((200 / 420) * 100));
        expect(mockUpdateProgress).toHaveBeenNthCalledWith(2, JOB_ID, TASK_ID, Math.round((400 / 420) * 100));
      });

      it('should not report progress for a tile set smaller than one concurrency window', async () => {
        await strategy.execute(s3Params);

        expect(mockUpdateProgress).not.toHaveBeenCalled();
      });

      it('should not flush an empty trailing batch when the tile count divides evenly', async () => {
        // 200 tiles = exactly batchSize (100) × concurrency (2) → one window, no remainder
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 9, minY: 0, maxY: 19 }],
        };

        await strategy.execute(params);

        expect(MockS3Provider.delete).toHaveBeenCalledTimes(2);
        expect(mockUpdateProgress).toHaveBeenCalledTimes(1);
        expect(mockUpdateProgress).toHaveBeenCalledWith(JOB_ID, TASK_ID, 100);
      });

      it('should pass the correct jobId and taskId on mid-stream updates', async () => {
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 13, minY: 0, maxY: 14 }],
        };

        await strategy.execute(params);

        expect(mockUpdateProgress).toHaveBeenCalledWith(JOB_ID, TASK_ID, expect.any(Number));
      });

      it('should not call updateProgress when retryable failures occur', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({ failures: new Map([['AccessDenied', { count: 1, sample: tilePath(10, 0, 0) }]]) });

        await expect(strategy.execute(s3Params)).rejects.toThrow(RecoverableError);

        expect(mockUpdateProgress).not.toHaveBeenCalled();
      });

      it('should not call updateProgress when only not-found failures occur', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({ failures: new Map([['NoSuchKey', { count: 1, sample: tilePath(10, 0, 0) }]]) });

        await expect(strategy.execute(s3Params)).resolves.toBeUndefined();
        expect(mockUpdateProgress).not.toHaveBeenCalled();
      });
    });

    describe('failure handling', () => {
      it('should throw RecoverableError when provider returns fatal failed paths', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({ failures: new Map([['AccessDenied', { count: 1, sample: tilePath(10, 0, 0) }]]) });

        await expect(strategy.execute(s3Params)).rejects.toThrow(RecoverableError);
      });

      it('should include fatal failed count in RecoverableError message', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({ failures: new Map([['AccessDenied', { count: 2, sample: tilePath(10, 0, 0) }]]) });

        await expect(strategy.execute(s3Params)).rejects.toThrow(/Failed to delete 2/);
      });

      it('should include grouped reason counts in RecoverableError message', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({
          failures: new Map([
            ['EACCES', { count: 2, sample: tilePath(10, 0, 0) }],
            ['AccessDenied', { count: 1, sample: tilePath(10, 1, 0) }],
          ]),
        });

        await expect(strategy.execute(s3Params)).rejects.toThrow(/Reasons: EACCES=2, AccessDenied=1/);
      });

      it('should exclude not-found reasons from the RecoverableError reason summary', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({
          failures: new Map([
            ['NoSuchKey', { count: 1, sample: tilePath(10, 0, 0) }],
            ['AccessDenied', { count: 1, sample: tilePath(10, 0, 1) }],
          ]),
        });

        await expect(strategy.execute(s3Params)).rejects.toThrow(/Failed to delete 1.*Reasons: AccessDenied=1/);
      });

      it('should include path and reason in the failure sample', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({ failures: new Map([['AccessDenied', { count: 1, sample: tilePath(10, 0, 0) }]]) });

        await expect(strategy.execute(s3Params)).rejects.toThrow(/layer\/v1\/10\/0\/0\.png \(AccessDenied\)/);
      });

      it('should resolve successfully when all failures are not-found (ENOENT)', async () => {
        vi.mocked(MockFsProvider.delete).mockResolvedValue({
          failures: new Map([['ENOENT', { count: 1, sample: tilePath(10, 0, 0) }]]),
        });

        await expect(strategy.execute(fsParams)).resolves.toBeUndefined();
      });

      it('should resolve successfully when all failures are not-found (NoSuchKey)', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({ failures: new Map([['NoSuchKey', { count: 1, sample: tilePath(10, 0, 0) }]]) });

        await expect(strategy.execute(s3Params)).resolves.toBeUndefined();
      });

      it('should resolve successfully when provider returns no failed paths', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue({ failures: new Map() });

        await expect(strategy.execute(s3Params)).resolves.toBeUndefined();
      });

      it('should throw RecoverableError when a batch rejects entirely (hard failure)', async () => {
        vi.mocked(MockS3Provider.delete).mockRejectedValue(new Error('S3 connection lost'));

        await expect(strategy.execute(s3Params)).rejects.toThrow(RecoverableError);
      });

      it('should count all paths in a hard-rejected batch as failed', async () => {
        // s3Params has 4 tiles (2×2); all 4 must surface in the error when the batch rejects
        vi.mocked(MockS3Provider.delete).mockRejectedValue(new Error('S3 connection lost'));

        await expect(strategy.execute(s3Params)).rejects.toThrow(/Failed to delete 4/);
      });

      it('should tag hard-rejected batch failures with the thrown error message as reason', async () => {
        vi.mocked(MockS3Provider.delete).mockRejectedValue(new Error('S3 connection lost'));

        await expect(strategy.execute(s3Params)).rejects.toThrow(/S3 connection lost/);
      });

      it('should aggregate hard failures of the same reason across concurrent batches', async () => {
        // 200 tiles → two batches of 100, both rejecting with the same error
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 9, minY: 0, maxY: 19 }],
        };
        vi.mocked(MockS3Provider.delete).mockRejectedValue(new Error('S3 connection lost'));

        // count is the sum of both batches, sample comes from the first batch that failed
        await expect(strategy.execute(params)).rejects.toThrow(
          `Failed to delete 200 tiles. Reasons: S3 connection lost=200. Samples: ${tilePath(5, 0, 0)} (S3 connection lost)`
        );
      });

      it('should aggregate hard failures of different reasons across concurrent batches', async () => {
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 9, minY: 0, maxY: 19 }],
        };
        vi.mocked(MockS3Provider.delete).mockRejectedValueOnce(new Error('first down')).mockRejectedValueOnce(new Error('second down'));

        await expect(strategy.execute(params)).rejects.toThrow(/Reasons: first down=100, second down=100/);
      });

      it('should surface both soft failures and hard rejections from the same flush', async () => {
        const params: S3TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 9, minY: 0, maxY: 19 }],
        };
        vi.mocked(MockS3Provider.delete)
          .mockResolvedValueOnce({ failures: new Map([['AccessDenied', { count: 3, sample: tilePath(5, 0, 0) }]]) })
          .mockRejectedValueOnce(new Error('S3 connection lost'));

        // reasons are ordered by descending count
        await expect(strategy.execute(params)).rejects.toThrow(/Failed to delete 103 tiles\. Reasons: S3 connection lost=100, AccessDenied=3/);
      });

      it('should tag hard-rejected batches with the errno code when the thrown error carries one', async () => {
        vi.mocked(MockFsProvider.delete).mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

        await expect(strategy.execute(fsParams)).rejects.toThrow(/Reasons: EACCES=4/);
      });

      it('should treat a hard-rejected batch tagged ENOENT as missing tiles rather than a retryable failure', async () => {
        vi.mocked(MockFsProvider.delete).mockRejectedValue(Object.assign(new Error('no such file'), { code: 'ENOENT' }));

        await expect(strategy.execute(fsParams)).resolves.toBeUndefined();
      });
    });
  });
});
