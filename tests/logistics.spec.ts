import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import { initConfig } from '@src/common/config';
import { SERVICES } from '@src/common/constants';
import { registerExternalValues } from '@src/containerConfig';
import { LogisticsManager } from '@src/logistics/manager';
import { createFakeJobTaskChain, createFakeTaskHandlerContext } from './helpers/fakes';

describe('Logistics', function () {
  let taskHandler: LogisticsManager['handleDeliveryTask'];

  beforeAll(async function () {
    try {
      await initConfig(true);
    } catch (error) {
      console.error('Failed to initialize config in tests:', error);
      throw error;
    }
  });

  beforeEach(async function () {
    const container = await registerExternalValues({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
      useChild: true,
    });

    vi.useFakeTimers();

    const logisticsManager = container.resolve(LogisticsManager);
    taskHandler = logisticsManager.handleDeliveryTask.bind(logisticsManager);
  });

  describe('Happy Path', function () {
    it('should handle pickup task successfully', async function () {
      const {
        job: fakeJob,
        stage: fakeStage,
        task: fakeTask,
      } = createFakeJobTaskChain({ userMetadata: { casualtyCount: 0 } }, {}, { data: { quantity: 10 } });

      const context = createFakeTaskHandlerContext(fakeJob, fakeStage);
      context.updateStageUserMetadata.mockResolvedValue(undefined);

      const result = taskHandler(fakeTask, context);

      vi.runAllTimers();

      await expect(result).resolves.toBeUndefined();
    });
  });

  describe('Sad Path', function () {
    it('should throw an error when casualty count exceeds quantity', async function () {
      const {
        job: fakeJob,
        stage: fakeStage,
        task: fakeTask,
      } = createFakeJobTaskChain({ userMetadata: { casualtyCount: 15 } }, {}, { data: { quantity: 10 } });

      const context = createFakeTaskHandlerContext(fakeJob, fakeStage);
      context.updateStageUserMetadata.mockResolvedValue(undefined);

      const result = taskHandler(fakeTask, context);

      await expect(result).rejects.toThrow('Casualty count exceeds quantity to be picked up');
    });
  });
});
