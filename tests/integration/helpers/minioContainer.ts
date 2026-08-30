/* eslint-disable @typescript-eslint/naming-convention */
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

interface MinioHandle {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop: () => Promise<void>;
}

/**
 * Pinned to the release running on our Azure deployment, so the suite exercises the same server
 * behavior we deploy against.
 */
const MINIO_IMAGE = 'minio/minio:RELEASE.2025-07-23T15-54-02Z';
const MINIO_PORT = 9000;
const DEFAULT_USER = 'minioadmin';
const DEFAULT_PASSWORD = 'minioadmin';

async function startMinio(): Promise<MinioHandle> {
  const externalEndpoint = process.env.TEST_MINIO_ENDPOINT;
  if (externalEndpoint !== undefined && externalEndpoint !== '') {
    return {
      endpoint: externalEndpoint,
      accessKeyId: process.env.TEST_MINIO_ACCESS_KEY ?? DEFAULT_USER,
      secretAccessKey: process.env.TEST_MINIO_SECRET_KEY ?? DEFAULT_PASSWORD,
      stop: async (): Promise<void> => Promise.resolve(),
    };
  }
  console.log('No external Minio endpoint configured, starting testcontainer instance');
  const container: StartedTestContainer = await new GenericContainer(MINIO_IMAGE)
    .withCommand(['server', '/data'])
    .withEnvironment({
      MINIO_ROOT_USER: DEFAULT_USER,
      MINIO_ROOT_PASSWORD: DEFAULT_PASSWORD,
    })
    .withExposedPorts(MINIO_PORT)
    .start();

  return {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(MINIO_PORT)}`,
    accessKeyId: DEFAULT_USER,
    secretAccessKey: DEFAULT_PASSWORD,
    stop: async (): Promise<void> => {
      try {
        await container.stop();
      } catch {
        // ignore; Ryuk will clean up on test process exit
      }
    },
  };
}

export { startMinio, type MinioHandle };
