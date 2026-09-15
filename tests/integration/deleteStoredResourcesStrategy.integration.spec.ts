import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import { useStorageBackends } from './helpers/backendFixtures';
import { sadPathProviders } from './helpers/storageBackends';
import { storedResourcesBackends, type ResourceBackend } from './helpers/storedResourcesBackends';
import {
  expectTaskAcked,
  expectTaskRejectedUnrecoverable,
  runTask,
  storedResourcesDeletionUnderTest,
  type RunTaskParams,
} from './helpers/testPoller';

const ZOOM = 10;

const layerName = (): string => `layer-${faker.string.alphanumeric({ length: 8, casing: 'lower' })}`;
const layerTiles = (backend: ResourceBackend, layer: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => backend.tileKey(layer, ZOOM, i, i + 1));

describe('stored resources deletion E2E (polling → strategy → real provider → ack)', () => {
  const harness = useStorageBackends();
  const { storageContext } = harness;

  describe.each(storedResourcesBackends(harness))('$storageProvider provider', (backend) => {
    const strategyUnderTest = storedResourcesDeletionUnderTest(backend.storageProvider);
    const runStoredResourcesDeletion = async (params: unknown, overrides: Partial<RunTaskParams> = {}): ReturnType<typeof runTask> =>
      runTask({ strategyUnderTest, providers: storageContext().providers, params, ...overrides });

    describe('happy path', () => {
      it('polls the task, wipes the whole layer, and acks while leaving other layers intact', async () => {
        const target = layerName();
        const survivors = layerTiles(backend, layerName(), 3);
        // 25 tiles is enough to cross the small Redis SCAN and UNLINK page sizes the fixtures configure.
        await backend.seed([...layerTiles(backend, target, 25), ...survivors]);

        const run = await runStoredResourcesDeletion(backend.buildParams([target]));

        expect(await backend.list()).toEqual([...survivors].sort());
        expectTaskAcked(run);
      });

      it('acks a task for a layer that holds nothing, so redelivery is idempotent', async () => {
        const survivors = layerTiles(backend, layerName(), 2);
        await backend.seed(survivors);

        const run = await runStoredResourcesDeletion(backend.buildParams([layerName()]));

        expect(await backend.list()).toEqual([...survivors].sort());
        expectTaskAcked(run);
      });

      it.runIf(backend.supportsMultipleLayers)('wipes every listed layer in one task and nothing else', async () => {
        const targets = [layerName(), layerName()];
        const survivors = layerTiles(backend, layerName(), 2);
        await backend.seed([...targets.flatMap((layer) => layerTiles(backend, layer, 4)), ...survivors]);

        const run = await runStoredResourcesDeletion(backend.buildParams(targets));

        expect(await backend.list()).toEqual([...survivors].sort());
        expectTaskAcked(run);
      });
    });

    describe('sad path', () => {
      it('rejects the task as unrecoverable without acking', async () => {
        const { params, reason } = backend.sadPath;

        const run = await runStoredResourcesDeletion(params(), { providers: sadPathProviders(backend.sadPath, storageContext()) });

        expectTaskRejectedUnrecoverable(run, reason);
      });
    });
  });
});
