/* eslint-disable @typescript-eslint/naming-convention -- Prometheus label names are snake_case */
import { describe, it, expect, beforeEach } from 'vitest';
import { Registry, type MetricValue } from 'prom-client';
import { CleanerMetrics, TaskStatus } from '@src/cleaner/metrics';
import type { DeleteFailure } from '@src/cleaner/storageProviders';

const getValues = async (registry: Registry, name: string): Promise<MetricValue<string>[]> => {
  const metric = registry.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} is not registered`);
  return (await metric.get()).values;
};

describe('CleanerMetrics', () => {
  let registry: Registry;
  let metrics: CleanerMetrics;

  beforeEach(() => {
    registry = new Registry();
    metrics = new CleanerMetrics(registry);
  });

  it('throws when registered twice on the same registry', () => {
    expect(() => new CleanerMetrics(registry)).toThrow();
  });

  describe('trackInProgress', () => {
    it('increments the gauge while running and decrements after resolving', async () => {
      const labels = { taskType: 'tiles-deletion', strategy: 'tiles_deletion' };
      let duringRun: number | undefined;

      await metrics.trackInProgress(labels, async () => {
        duringRun = (await getValues(registry, 'cleaner_tasks_in_progress'))[0]?.value;
      });

      expect(duringRun).toBe(1);
      expect((await getValues(registry, 'cleaner_tasks_in_progress'))[0]?.value).toBe(0);
    });

    it('decrements the gauge and rethrows when the run rejects', async () => {
      const labels = { taskType: 'tiles-deletion', strategy: 'tiles_deletion' };

      await expect(metrics.trackInProgress(labels, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

      expect((await getValues(registry, 'cleaner_tasks_in_progress'))[0]?.value).toBe(0);
    });
  });

  describe('recordTaskCompletion', () => {
    it('increments the task counter and observes the duration with the same labels', async () => {
      const labels = { jobType: 'Delete_Layer', taskType: 'tiles-deletion', strategy: 'delete_stored_resources' };

      metrics.recordTaskCompletion(labels, TaskStatus.RETRIED, 12);

      expect(await getValues(registry, 'cleaner_tasks_total')).toEqual([
        {
          value: 1,
          labels: { job_type: 'Delete_Layer', task_type: 'tiles-deletion', strategy: 'delete_stored_resources', status: 'retried' },
        },
      ]);
      const durationSum = (await getValues(registry, 'cleaner_task_duration_seconds')).find(
        (v) => (v as { metricName?: string }).metricName === 'cleaner_task_duration_seconds_sum'
      );
      expect(durationSum?.value).toBe(12);
      expect(durationSum?.labels.status).toBe('retried');
    });
  });

  describe('recordDeleted', () => {
    it('adds the count per strategy and provider', async () => {
      const labels = { strategy: 'tiles_deletion', storageProvider: 'S3' };

      metrics.recordDeleted(labels, 10);
      metrics.recordDeleted(labels, 5);

      expect(await getValues(registry, 'cleaner_objects_deleted_total')).toEqual([
        { value: 15, labels: { strategy: 'tiles_deletion', storage_provider: 'S3' } },
      ]);
    });

    it('creates the series at zero for a zero count', async () => {
      metrics.recordDeleted({ strategy: 'tiles_deletion', storageProvider: 'S3' }, 0);

      expect(await getValues(registry, 'cleaner_objects_deleted_total')).toEqual([
        { value: 0, labels: { strategy: 'tiles_deletion', storage_provider: 'S3' } },
      ]);
    });
  });

  describe('recordFailures', () => {
    it('maps raw reasons to bounded reasons and sums their counts', async () => {
      const failures: DeleteFailure = new Map([
        ['ENOENT', { count: 3, sample: 'a' }],
        ['NoSuchKey', { count: 2, sample: 'b' }],
        ['some unexpected message /with/a/path', { count: 1, sample: 'c' }],
      ]);

      metrics.recordFailures({ strategy: 'tiles_deletion', storageProvider: 'FS' }, failures);

      expect(await getValues(registry, 'cleaner_objects_failed_total')).toEqual(
        expect.arrayContaining([
          { value: 5, labels: { strategy: 'tiles_deletion', storage_provider: 'FS', reason: 'not_found' } },
          { value: 1, labels: { strategy: 'tiles_deletion', storage_provider: 'FS', reason: 'other' } },
        ])
      );
    });
  });

  describe('recordTilesDeletedByZoom', () => {
    it('adds the count per provider and zoom', async () => {
      metrics.recordTilesDeletedByZoom('REDIS', 7, 4);

      expect(await getValues(registry, 'cleaner_tiles_deleted_by_zoom_total')).toEqual([
        { value: 4, labels: { storage_provider: 'REDIS', zoom: '7' } },
      ]);
    });

    it('creates the series at zero for a zero count', async () => {
      metrics.recordTilesDeletedByZoom('REDIS', 7, 0);

      expect(await getValues(registry, 'cleaner_tiles_deleted_by_zoom_total')).toEqual([
        { value: 0, labels: { storage_provider: 'REDIS', zoom: '7' } },
      ]);
    });
  });

  describe('startBatchTimer', () => {
    it('observes one batch duration when the returned function is called', async () => {
      const end = metrics.startBatchTimer('FS');
      end();

      const count = (await getValues(registry, 'cleaner_delete_batch_duration_seconds')).find(
        (v) => (v as { metricName?: string }).metricName === 'cleaner_delete_batch_duration_seconds_count'
      );
      expect(count?.value).toBe(1);
    });
  });
});
