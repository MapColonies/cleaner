import { describe, it, expect, beforeEach, vi } from 'vitest';
import { type TilesDeletionParams, SourceType } from '@map-colonies/raster-shared';
import type { TaskHandler as QueueClient } from '@map-colonies/mc-priority-queue';
import { faker } from '@faker-js/faker';
import { TilesDeletionStrategy } from '@src/cleaner/strategies/tilesDeletionStrategy';
import type { TaskContext } from '@src/cleaner/strategies/strategyFactory';
import { ValidationError, RecoverableError, UnrecoverableError } from '@src/cleaner/errors';
import type { IStorageProvider } from '@src/cleaner/storageProviders';
import { createMockLogger, createMockStorageProvider, createMockStrategyConfig, TILES_DELETION_CONFIG_DEFAULTS } from './helpers/mocks';

const { s3Bucket: S3_BUCKET, fsBasePath: FS_BASE_PATH } = TILES_DELETION_CONFIG_DEFAULTS;

const JOB_ID = faker.string.uuid();
const TASK_ID = faker.string.uuid();
const TASK_CONTEXT: TaskContext = { jobId: JOB_ID, taskId: TASK_ID, jobType: 'Ingestion_Update', taskType: 'tiles-deletion' };

const s3Params: TilesDeletionParams = {
  sourceProvider: 'S3',
  tilesPath: 'layer/v1',
  fileExtension: 'png',
  ranges: [{ zoom: 10, minX: 0, maxX: 1, minY: 0, maxY: 1 }],
};

const fsParams: TilesDeletionParams = { ...s3Params, sourceProvider: 'FS' };

// Builds an expected tile path under the standard s3Params tilesPath/fileExtension.
const tilePath = (z: number, x: number, y: number): string => `${s3Params.tilesPath}/${z}/${x}/${y}.${s3Params.fileExtension}`;

describe('TilesDeletionStrategy', () => {
  let strategy: TilesDeletionStrategy;
  let MockS3Provider: IStorageProvider;
  let MockFsProvider: IStorageProvider;
  let mockUpdateProgress: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MockS3Provider = createMockStorageProvider();
    MockFsProvider = createMockStorageProvider();
    mockUpdateProgress = vi.fn().mockResolvedValue(undefined);

    const storageProviders = new Map<SourceType, IStorageProvider>([
      [SourceType.S3, MockS3Provider],
      [SourceType.FS, MockFsProvider],
    ]);
    const queueClient = { updateProgress: mockUpdateProgress } as unknown as QueueClient;

    strategy = new TilesDeletionStrategy(createMockLogger(), createMockStrategyConfig(), storageProviders, queueClient, TASK_CONTEXT);
  });

  describe('validate', () => {
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

    it('should throw ValidationError when sourceProvider is missing', () => {
      expect(() => strategy.validate({ ...s3Params, sourceProvider: undefined })).toThrow(ValidationError);
    });

    it('should throw ValidationError for unsupported sourceProvider value', () => {
      expect(() => strategy.validate({ ...s3Params, sourceProvider: 'GCS' })).toThrow(ValidationError);
    });

    it('should throw ValidationError for empty ranges array', () => {
      expect(() => strategy.validate({ ...s3Params, ranges: [] })).toThrow(ValidationError);
    });

    it('should throw ValidationError for empty tilesPath', () => {
      expect(() => strategy.validate({ ...s3Params, tilesPath: '' })).toThrow(ValidationError);
    });

    it('should throw ValidationError when params is null', () => {
      expect(() => strategy.validate(null)).toThrow(ValidationError);
    });
  });

  describe('execute', () => {
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

      it('should check targetExists with S3 bucket and tilesPath as relativePath', async () => {
        await strategy.execute(s3Params);

        expect(MockS3Provider.targetExists).toHaveBeenCalledWith(S3_BUCKET, s3Params.tilesPath);
      });

      it('should check targetExists with FS base path and tilesPath as relativePath', async () => {
        await strategy.execute(fsParams);

        expect(MockFsProvider.targetExists).toHaveBeenCalledWith(FS_BASE_PATH, fsParams.tilesPath);
      });
    });

    describe('provider routing', () => {
      it('should call S3 provider with s3Bucket as storage target', async () => {
        await strategy.execute(s3Params);

        expect(MockS3Provider.delete).toHaveBeenCalledWith(expect.any(Array), S3_BUCKET);
        expect(MockFsProvider.delete).not.toHaveBeenCalled();
      });

      it('should call FS provider with fsBasePath as storage target', async () => {
        await strategy.execute(fsParams);

        expect(MockFsProvider.delete).toHaveBeenCalledWith(expect.any(Array), FS_BASE_PATH);
        expect(MockS3Provider.delete).not.toHaveBeenCalled();
      });

      it('should throw UnrecoverableError for unknown provider', async () => {
        const unknownParams = { ...s3Params, sourceProvider: 'UNKNOWN' } as unknown as TilesDeletionParams;

        await expect(strategy.execute(unknownParams)).rejects.toThrow(UnrecoverableError);
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
        const params: TilesDeletionParams = { ...s3Params, fileExtension: 'jpeg' };

        await strategy.execute(params);

        const [paths] = vi.mocked(MockS3Provider.delete).mock.calls[0]!;
        expect(paths.every((p) => p.endsWith('.jpeg'))).toBe(true);
      });

      it('should concatenate tiles from multiple ranges', async () => {
        const params: TilesDeletionParams = {
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
        const params: TilesDeletionParams = {
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
        const params: TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 13, minY: 0, maxY: 14 }],
        };

        await strategy.execute(params);

        expect(mockUpdateProgress).toHaveBeenCalledTimes(1);
        expect(mockUpdateProgress).not.toHaveBeenCalledWith(JOB_ID, TASK_ID, 100);
      });

      it('should pass the correct jobId and taskId on mid-stream updates', async () => {
        const params: TilesDeletionParams = {
          ...s3Params,
          ranges: [{ zoom: 5, minX: 0, maxX: 13, minY: 0, maxY: 14 }],
        };

        await strategy.execute(params);

        expect(mockUpdateProgress).toHaveBeenCalledWith(JOB_ID, TASK_ID, expect.any(Number));
      });

      it('should not call updateProgress when retryable failures occur', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([{ path: tilePath(10, 0, 0), reason: 'AccessDenied' }]);

        await expect(strategy.execute(s3Params)).rejects.toThrow(RecoverableError);

        expect(mockUpdateProgress).not.toHaveBeenCalled();
      });

      it('should not call updateProgress when only not-found failures occur', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([{ path: tilePath(10, 0, 0), reason: 'NoSuchKey' }]);

        await expect(strategy.execute(s3Params)).resolves.toBeUndefined();
        expect(mockUpdateProgress).not.toHaveBeenCalled();
      });
    });

    describe('failure handling', () => {
      it('should throw RecoverableError when provider returns fatal failed paths', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([{ path: tilePath(10, 0, 0), reason: 'AccessDenied' }]);

        await expect(strategy.execute(s3Params)).rejects.toThrow(RecoverableError);
      });

      it('should include fatal failed count in RecoverableError message', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([
          { path: tilePath(10, 0, 0), reason: 'AccessDenied' },
          { path: tilePath(10, 0, 1), reason: 'AccessDenied' },
        ]);

        await expect(strategy.execute(s3Params)).rejects.toThrow(/Failed to delete 2/);
      });

      it('should include grouped reason counts in RecoverableError message', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([
          { path: tilePath(10, 0, 0), reason: 'EACCES' },
          { path: tilePath(10, 0, 1), reason: 'EACCES' },
          { path: tilePath(10, 1, 0), reason: 'AccessDenied' },
        ]);

        await expect(strategy.execute(s3Params)).rejects.toThrow(/Reasons: EACCES=2, AccessDenied=1/);
      });

      it('should exclude not-found reasons from the RecoverableError reason summary', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([
          { path: tilePath(10, 0, 0), reason: 'NoSuchKey' },
          { path: tilePath(10, 0, 1), reason: 'AccessDenied' },
        ]);

        await expect(strategy.execute(s3Params)).rejects.toThrow(/Failed to delete 1.*Reasons: AccessDenied=1/);
      });

      it('should include path and reason in the failure sample', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([{ path: tilePath(10, 0, 0), reason: 'AccessDenied' }]);

        await expect(strategy.execute(s3Params)).rejects.toThrow(/layer\/v1\/10\/0\/0\.png \(AccessDenied\)/);
      });

      it('should resolve successfully when all failures are not-found (ENOENT)', async () => {
        vi.mocked(MockFsProvider.delete).mockResolvedValue([
          { path: tilePath(10, 0, 0), reason: 'ENOENT' },
          { path: tilePath(10, 0, 1), reason: 'ENOENT' },
        ]);

        await expect(strategy.execute(fsParams)).resolves.toBeUndefined();
      });

      it('should resolve successfully when all failures are not-found (NoSuchKey)', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([{ path: tilePath(10, 0, 0), reason: 'NoSuchKey' }]);

        await expect(strategy.execute(s3Params)).resolves.toBeUndefined();
      });

      it('should resolve successfully when provider returns no failed paths', async () => {
        vi.mocked(MockS3Provider.delete).mockResolvedValue([]);

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
    });
  });
});
