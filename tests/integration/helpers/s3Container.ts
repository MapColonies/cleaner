/* eslint-disable @typescript-eslint/naming-convention */
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

interface S3Handle {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop: () => Promise<void>;
}

/**
 * Any S3-compatible server works here. Pinned to the image our infra deploys (currently SeaweedFS's
 * S3 gateway), so the suite exercises the same server behavior.
 */
const S3_IMAGE = 'docker.io/chrislusf/seaweedfs:4.47';
const S3_PORT = 8333;
const DEFAULT_USER = 'minioadmin';
const DEFAULT_PASSWORD = 'minioadmin';

async function startS3(): Promise<S3Handle> {
  const externalEndpoint = process.env.TEST_S3_ENDPOINT;
  if (externalEndpoint !== undefined && externalEndpoint !== '') {
    console.warn(`S3: using EXTERNAL server at ${externalEndpoint} (TEST_S3_ENDPOINT is set).`);
    console.warn('S3: this suite CREATES AND DELETES buckets on that server. Unset TEST_S3_ENDPOINT to use a testcontainer.');
    return {
      endpoint: externalEndpoint,
      accessKeyId: process.env.TEST_S3_ACCESS_KEY ?? DEFAULT_USER,
      secretAccessKey: process.env.TEST_S3_SECRET_KEY ?? DEFAULT_PASSWORD,
      stop: async (): Promise<void> => Promise.resolve(),
    };
  }
  console.log(`S3: TEST_S3_ENDPOINT is not set, starting testcontainer from ${S3_IMAGE}`);
  const container: StartedTestContainer = await new GenericContainer(S3_IMAGE)
    .withCommand(['server', '-s3', '-dir=/data'])
    // SeaweedFS registers these as the S3 admin identity
    .withEnvironment({
      AWS_ACCESS_KEY_ID: DEFAULT_USER,
      AWS_SECRET_ACCESS_KEY: DEFAULT_PASSWORD,
    })
    .withExposedPorts(S3_PORT)
    .start();

  return {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`,
    accessKeyId: DEFAULT_USER,
    secretAccessKey: DEFAULT_PASSWORD,
    stop: async (): Promise<void> => {
      try {
        await container.stop();
      } catch (error) {
        // Non-fatal: Ryuk reaps the container on test process exit, unless it is disabled.
        console.warn('Failed to stop S3 container; relying on Ryuk to reap it', error);
      }
    },
  };
}

export { startS3, type S3Handle };
