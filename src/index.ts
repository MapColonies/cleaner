// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { createServer } from 'node:http';
import express from 'express';
import { metricsMiddleware } from '@map-colonies/telemetry/prom-metrics';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import type { IWorker } from '@map-colonies/jobnik-sdk';
import { SERVICES } from '@common/constants';
import { ConfigType } from '@common/config';
import { registerExternalValues } from './containerConfig';
import { LogisticsSDK } from './logistics/types';
import { seedData } from './seeder';

void registerExternalValues()
  .then(async (container) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    const config = container.resolve<ConfigType>(SERVICES.CONFIG);
    const worker = container.resolve<IWorker>(SERVICES.WORKER);

    // REMOVE THIS IN PRODUCTION - for demo purposes only
    const sdk = container.resolve<LogisticsSDK>(SERVICES.JOBNIK_SDK);
    await seedData(sdk.getProducer());
    // END REMOVE THIS IN PRODUCTION - for demo purposes only

    const port = config.get('server.port');
    const stubHealthCheck = async (): Promise<void> => Promise.resolve();

    const app = express();

    app.use(metricsMiddleware(container.resolve(SERVICES.METRICS), true));
    const server = createTerminus(createServer(app), { healthChecks: { '/liveness': stubHealthCheck }, onSignal: container.resolve('onSignal') });
    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
    });

    await worker.start();
  })
  .catch((error: Error) => {
    console.error('😢 - failed initializing the worker');
    console.error(error);
    process.exit(1);
  });
