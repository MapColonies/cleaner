/* eslint-disable @typescript-eslint/naming-convention */
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import type { Logger } from '@map-colonies/js-logger';
import type { ConfigType } from '@common/config';
import type { IStorageProvider } from './iStorageProvider';

const S3_MAX_DELETE_BATCH = 1000;
const S3_ERROR_NO_SUCH_KEY = 'NoSuchKey';

interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  region: string;
}

export class S3StorageProvider implements IStorageProvider {
  private readonly s3Client: S3Client;

  public constructor(
    config: ConfigType,
    private readonly logger: Logger
  ) {
    const s3Config = config.get('s3') as S3Config;
    this.s3Client = new S3Client({
      endpoint: s3Config.endpoint,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      forcePathStyle: s3Config.forcePathStyle,
      region: s3Config.region,
    });
  }

  public async delete(paths: string[], storageTarget: string): Promise<string[]> {
    if (paths.length === 0) {
      return [];
    }

    this.logger.info({ msg: 'Deleting objects from S3', bucket: storageTarget, count: paths.length });

    const failedPaths: string[] = [];

    for (const chunk of this.chunk(paths, S3_MAX_DELETE_BATCH)) {
      try {
        const failed = await this.deleteChunk(chunk, storageTarget);
        failedPaths.push(...failed);
      } catch (error) {
        this.logger.error({ msg: 'S3 batch request failed', bucket: storageTarget, error });
        failedPaths.push(...chunk);
      }
    }

    return failedPaths;
  }

  private async deleteChunk(paths: string[], bucket: string): Promise<string[]> {
    const command = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: paths.map((Key) => ({ Key })) },
    });

    const response = await this.s3Client.send(command);
    return (response.Errors ?? [])
      .filter((e) => e.Code !== S3_ERROR_NO_SUCH_KEY)
      .map((e) => e.Key ?? '')
      .filter(Boolean);
  }

  private chunk(paths: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < paths.length; i += size) {
      chunks.push(paths.slice(i, i + size));
    }
    return chunks;
  }
}
