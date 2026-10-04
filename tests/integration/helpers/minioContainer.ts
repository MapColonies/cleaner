/* eslint-disable @typescript-eslint/naming-convention */
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

interface MinioHandle {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop: () => Promise<void>;
}

/**
 * SeaweedFS's S3 gateway, pinned to the image our infra deploys, so the suite exercises the same
 * server behavior. MinIO no longer serves its images anonymously on Docker Hub or Quay.
 */
const MINIO_IMAGE = 'docker.io/chrislusf/seaweedfs:4.47';
const MINIO_PORT = 8333;
const DEFAULT_USER = 'minioadmin';
const DEFAULT_PASSWORD = 'minioadmin';

async function startMinio(): Promise<MinioHandle> {
  const externalEndpoint = process.env.TEST_MINIO_ENDPOINT;
  if (externalEndpoint !== undefined && externalEndpoint !== '') {
    console.warn(`Minio: using EXTERNAL server at ${externalEndpoint} (TEST_MINIO_ENDPOINT is set).`);
    console.warn('Minio: this suite CREATES AND DELETES buckets on that server. Unset TEST_MINIO_ENDPOINT to use a testcontainer.');
    return {
      endpoint: externalEndpoint,
      accessKeyId: process.env.TEST_MINIO_ACCESS_KEY ?? DEFAULT_USER,
      secretAccessKey: process.env.TEST_MINIO_SECRET_KEY ?? DEFAULT_PASSWORD,
      stop: async (): Promise<void> => Promise.resolve(),
    };
  }
  console.log(`Minio: TEST_MINIO_ENDPOINT is not set, starting testcontainer from ${MINIO_IMAGE}`);
  const container: StartedTestContainer = await new GenericContainer(MINIO_IMAGE)
    .withCommand(['server', '-s3', '-dir=/data'])
    // SeaweedFS registers these as the S3 admin identity
    .withEnvironment({
      AWS_ACCESS_KEY_ID: DEFAULT_USER,
      AWS_SECRET_ACCESS_KEY: DEFAULT_PASSWORD,
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
      } catch (error) {
        // Non-fatal: Ryuk reaps the container on test process exit, unless it is disabled.
        console.warn('Failed to stop Minio container; relying on Ryuk to reap it', error);
      }
    },
  };
}

export { startMinio, type MinioHandle };
