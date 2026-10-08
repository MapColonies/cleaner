/* eslint-disable @typescript-eslint/naming-convention -- Prometheus label names are snake_case */
import { Counter, Gauge, Histogram, type Registry } from 'prom-client';
import type { DeleteFailure } from '../storageProviders/iStorageProvider';
import { BATCH_DURATION_BUCKETS_SECONDS, TASK_DURATION_BUCKETS_SECONDS, type DeletionLabels, type TaskLabels, type TaskStatus } from './constants';
import { toFailureReason } from './failureReason';

/**
 * Cleaner-specific Prometheus metrics. Must be instantiated once per registry —
 * prom-client rejects registering the same metric name twice.
 */
export class CleanerMetrics {
  private readonly tasksTotal: Counter<'job_type' | 'task_type' | 'strategy' | 'status'>;
  private readonly taskDuration: Histogram<'job_type' | 'task_type' | 'strategy' | 'status'>;
  private readonly tasksInProgress: Gauge<'task_type' | 'strategy'>;
  private readonly objectsDeleted: Counter<'strategy' | 'storage_provider'>;
  private readonly objectsFailed: Counter<'strategy' | 'storage_provider' | 'reason'>;
  private readonly tilesDeletedByZoom: Counter<'storage_provider' | 'zoom'>;
  private readonly batchDuration: Histogram<'storage_provider'>;

  public constructor(registry: Registry) {
    const registers = [registry];

    this.tasksTotal = new Counter({
      name: 'cleaner_tasks_total',
      help: 'Processed tasks by outcome',
      labelNames: ['job_type', 'task_type', 'strategy', 'status'],
      registers,
    });
    this.taskDuration = new Histogram({
      name: 'cleaner_task_duration_seconds',
      help: 'Task processing duration in seconds, from dequeue to ack/reject',
      labelNames: ['job_type', 'task_type', 'strategy', 'status'],
      buckets: TASK_DURATION_BUCKETS_SECONDS,
      registers,
    });
    this.tasksInProgress = new Gauge({
      name: 'cleaner_tasks_in_progress',
      help: 'Tasks currently being executed',
      labelNames: ['task_type', 'strategy'],
      registers,
    });
    this.objectsDeleted = new Counter({
      name: 'cleaner_objects_deleted_total',
      help: 'Deleted objects (tiles, keys or objects; paths for FS stored-resources deletion)',
      labelNames: ['strategy', 'storage_provider'],
      registers,
    });
    this.objectsFailed = new Counter({
      name: 'cleaner_objects_failed_total',
      help: 'Objects that failed to delete, by bounded failure reason',
      labelNames: ['strategy', 'storage_provider', 'reason'],
      registers,
    });
    this.tilesDeletedByZoom = new Counter({
      name: 'cleaner_tiles_deleted_by_zoom_total',
      help: 'Tiles deleted by the tiles-deletion strategy, per zoom level',
      labelNames: ['storage_provider', 'zoom'],
      registers,
    });
    this.batchDuration = new Histogram({
      name: 'cleaner_delete_batch_duration_seconds',
      help: 'Duration of a single tiles-deletion batch delete call in seconds',
      labelNames: ['storage_provider'],
      buckets: BATCH_DURATION_BUCKETS_SECONDS,
      registers,
    });
  }

  public async trackInProgress<T>({ taskType, strategy }: Omit<TaskLabels, 'jobType'>, run: () => Promise<T>): Promise<T> {
    const labels = { task_type: taskType, strategy };
    this.tasksInProgress.inc(labels);
    try {
      return await run();
    } finally {
      this.tasksInProgress.dec(labels);
    }
  }

  public recordTaskCompletion({ jobType, taskType, strategy }: TaskLabels, status: TaskStatus, durationSeconds: number): void {
    const labels = { job_type: jobType, task_type: taskType, strategy, status };
    this.tasksTotal.inc(labels);
    this.taskDuration.observe(labels, durationSeconds);
  }

  /** Records zero counts too, so the series exists (at 0) as soon as a deletion runs. */
  public recordDeleted({ strategy, storageProvider }: DeletionLabels, count: number): void {
    this.objectsDeleted.inc({ strategy, storage_provider: storageProvider }, count);
  }

  public recordFailures({ strategy, storageProvider }: DeletionLabels, failures: DeleteFailure): void {
    for (const [rawReason, { count }] of failures) {
      this.objectsFailed.inc({ strategy, storage_provider: storageProvider, reason: toFailureReason(rawReason) }, count);
    }
  }

  public recordTilesDeletedByZoom(storageProvider: string, zoom: number, count: number): void {
    this.tilesDeletedByZoom.inc({ storage_provider: storageProvider, zoom: String(zoom) }, count);
  }

  /** @returns a function that records the elapsed batch duration when called */
  public startBatchTimer(storageProvider: string): () => void {
    const end = this.batchDuration.startTimer({ storage_provider: storageProvider });
    return () => {
      end();
    };
  }
}
