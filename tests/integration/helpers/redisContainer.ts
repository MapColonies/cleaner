/* eslint-disable @typescript-eslint/naming-convention */
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

interface RedisHandle {
  host: string;
  port: number;
  stop: () => Promise<void>;
}

/** Pinned to the image deployed in our environments; bump it when they move. */
const REDIS_IMAGE = 'docker.io/bitnamilegacy/redis:7.2.1';
const REDIS_PORT = 6379;

async function startRedis(): Promise<RedisHandle> {
  const externalHost = process.env.TEST_REDIS_HOST;
  if (externalHost !== undefined && externalHost !== '') {
    console.warn(`Redis: using EXTERNAL server at ${externalHost} (TEST_REDIS_HOST is set).`);
    console.warn('Redis: this suite FLUSHES THE DB on that server. Unset TEST_REDIS_HOST to use a testcontainer.');
    return {
      host: externalHost,
      port: Number(process.env.TEST_REDIS_PORT ?? REDIS_PORT),
      stop: async (): Promise<void> => Promise.resolve(),
    };
  }

  console.log(`Redis: TEST_REDIS_HOST is not set, starting testcontainer from ${REDIS_IMAGE}`);
  const container: StartedTestContainer = await new GenericContainer(REDIS_IMAGE)
    .withEnvironment({ ALLOW_EMPTY_PASSWORD: 'yes' })
    .withExposedPorts(REDIS_PORT)
    .start();

  return {
    host: container.getHost(),
    port: container.getMappedPort(REDIS_PORT),
    stop: async (): Promise<void> => {
      try {
        await container.stop();
      } catch (error) {
        // Non-fatal: Ryuk reaps the container on test process exit, unless it is disabled.
        console.warn('Failed to stop Redis container; relying on Ryuk to reap it', error);
      }
    },
  };
}

export { startRedis, type RedisHandle };
