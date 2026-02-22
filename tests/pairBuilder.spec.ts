import { describe, it, expect } from 'vitest';
import { buildPollingPairs } from '@src/cleaner/utils';
import { ConfigurationError } from '@src/cleaner/errors';
import type { JobDefinitions, WorkerCapabilities } from '@src/cleaner/types';

describe('buildPollingPairs', () => {
  it('should build polling pairs from declared capability pairs', () => {
    const capabilities: WorkerCapabilities = {
      pairs: [
        { job: 'Ingestion_Update', task: 'tiles-deletion' },
        { job: 'Ingestion_Swap_Update', task: 'tiles-deletion' },
      ],
    };

    const jobDefinitions: JobDefinitions = {
      jobs: {
        update: { type: 'Ingestion_Update' },
        swapUpdate: { type: 'Ingestion_Swap_Update' },
        export: { type: 'Export' }, // Not in capabilities
      },
      tasks: {
        tilesDeletion: { type: 'tiles-deletion', maxAttempts: 3 },
        init: { type: 'init' }, // Not in capabilities
      },
    };

    const pairs = buildPollingPairs(jobDefinitions, capabilities);

    expect(pairs).toHaveLength(2);
    expect(pairs).toEqual([
      { jobType: 'Ingestion_Update', taskType: 'tiles-deletion', maxAttempts: 3 },
      { jobType: 'Ingestion_Swap_Update', taskType: 'tiles-deletion', maxAttempts: 3 },
    ]);
  });

  it('should use default maxAttempts when not specified in task definition', () => {
    const capabilities: WorkerCapabilities = {
      pairs: [{ job: 'Ingestion_Update', task: 'tiles-deletion' }],
    };

    const jobDefinitions: JobDefinitions = {
      jobs: {
        update: { type: 'Ingestion_Update' },
      },
      tasks: {
        tilesDeletion: { type: 'tiles-deletion' }, // No maxAttempts
      },
    };

    const pairs = buildPollingPairs(jobDefinitions, capabilities);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({
      jobType: 'Ingestion_Update',
      taskType: 'tiles-deletion',
      maxAttempts: 3, // Default
    });
  });

  it('should support different tasks for different jobs', () => {
    const capabilities: WorkerCapabilities = {
      pairs: [
        { job: 'Ingestion_Update', task: 'tiles-deletion' },
        { job: 'Ingestion_Update', task: 'tiles-validation' },
        { job: 'Export', task: 'tiles-validation' },
      ],
    };

    const jobDefinitions: JobDefinitions = {
      jobs: {
        update: { type: 'Ingestion_Update' },
        export: { type: 'Export' },
      },
      tasks: {
        tilesDeletion: { type: 'tiles-deletion', maxAttempts: 3 },
        tilesValidation: { type: 'tiles-validation', maxAttempts: 5 },
      },
    };

    const pairs = buildPollingPairs(jobDefinitions, capabilities);

    expect(pairs).toHaveLength(3);
    expect(pairs).toContainEqual({
      jobType: 'Ingestion_Update',
      taskType: 'tiles-deletion',
      maxAttempts: 3,
    });
    expect(pairs).toContainEqual({
      jobType: 'Ingestion_Update',
      taskType: 'tiles-validation',
      maxAttempts: 5,
    });
    expect(pairs).toContainEqual({
      jobType: 'Export',
      taskType: 'tiles-validation',
      maxAttempts: 5,
    });
  });

  it('should throw ConfigurationError when declared job type is not in job definitions', () => {
    const capabilities: WorkerCapabilities = {
      pairs: [{ job: 'Non_Existent_Job', task: 'tiles-deletion' }],
    };

    const jobDefinitions: JobDefinitions = {
      jobs: {
        update: { type: 'Ingestion_Update' },
      },
      tasks: {
        tilesDeletion: { type: 'tiles-deletion' },
      },
    };

    expect(() => buildPollingPairs(jobDefinitions, capabilities)).toThrow(ConfigurationError);
    expect(() => buildPollingPairs(jobDefinitions, capabilities)).toThrow(
      'Worker declares capability for job type "Non_Existent_Job" but it\'s not defined in job definitions'
    );
  });

  it('should throw ConfigurationError when declared task type is not in job definitions', () => {
    const capabilities: WorkerCapabilities = {
      pairs: [{ job: 'Ingestion_Update', task: 'non-existent-task' }],
    };

    const jobDefinitions: JobDefinitions = {
      jobs: {
        update: { type: 'Ingestion_Update' },
      },
      tasks: {
        tilesDeletion: { type: 'tiles-deletion' },
      },
    };

    expect(() => buildPollingPairs(jobDefinitions, capabilities)).toThrow(ConfigurationError);
    expect(() => buildPollingPairs(jobDefinitions, capabilities)).toThrow(
      'Worker declares capability for task type "non-existent-task" but it\'s not defined in job definitions'
    );
  });

  it('should return empty array when no capability pairs declared', () => {
    const capabilities: WorkerCapabilities = {
      pairs: [], // No pairs
    };

    const jobDefinitions: JobDefinitions = {
      jobs: {
        update: { type: 'Ingestion_Update' },
      },
      tasks: {
        tilesDeletion: { type: 'tiles-deletion', maxAttempts: 3 },
      },
    };

    const pairs = buildPollingPairs(jobDefinitions, capabilities);

    expect(pairs).toHaveLength(0);
    expect(pairs).toEqual([]);
  });

  it('should handle realistic production scenario', () => {
    // Real-world scenario: cleaner worker handles tiles-deletion for specific update jobs
    const capabilities: WorkerCapabilities = {
      pairs: [
        { job: 'Ingestion_Update', task: 'tiles-deletion' },
        { job: 'Ingestion_Swap_Update', task: 'tiles-deletion' },
      ],
    };

    const jobDefinitions: JobDefinitions = {
      jobs: {
        new: { type: 'Ingestion_New' },
        update: { type: 'Ingestion_Update' },
        swapUpdate: { type: 'Ingestion_Swap_Update' },
        seed: { type: 'TilesSeeding' },
        export: { type: 'Export' },
      },
      tasks: {
        init: { type: 'init' },
        validation: { type: 'validation' },
        createTasks: { type: 'create-tasks' },
        merge: { type: 'tilesMerging' },
        polygonParts: { type: 'polygon-parts', suspendJobOnFail: true },
        finalize: { type: 'finalize' },
        seed: { type: 'TilesSeeding' },
        export: { type: 'tilesExporting' },
        tilesDeletion: { type: 'tiles-deletion', maxAttempts: 3 },
      },
    };

    const pairs = buildPollingPairs(jobDefinitions, capabilities);

    // Should only create 2 pairs as explicitly declared
    expect(pairs).toHaveLength(2);
    expect(pairs).toEqual([
      { jobType: 'Ingestion_Update', taskType: 'tiles-deletion', maxAttempts: 3 },
      { jobType: 'Ingestion_Swap_Update', taskType: 'tiles-deletion', maxAttempts: 3 },
    ]);

    // Verify other job types are NOT included
    expect(pairs).not.toContainEqual(expect.objectContaining({ jobType: 'Ingestion_New' }));
    expect(pairs).not.toContainEqual(expect.objectContaining({ jobType: 'TilesSeeding' }));
    expect(pairs).not.toContainEqual(expect.objectContaining({ jobType: 'Export' }));
  });

  it('should preserve maxAttempts from task definition for each pair', () => {
    const capabilities: WorkerCapabilities = {
      pairs: [
        { job: 'Ingestion_Update', task: 'tiles-deletion' },
        { job: 'Export', task: 'tiles-validation' },
      ],
    };

    const jobDefinitions: JobDefinitions = {
      jobs: {
        update: { type: 'Ingestion_Update' },
        export: { type: 'Export' },
      },
      tasks: {
        tilesDeletion: { type: 'tiles-deletion', maxAttempts: 5 },
        tilesValidation: { type: 'tiles-validation', maxAttempts: 7 },
      },
    };

    const pairs = buildPollingPairs(jobDefinitions, capabilities);

    expect(pairs).toEqual([
      { jobType: 'Ingestion_Update', taskType: 'tiles-deletion', maxAttempts: 5 },
      { jobType: 'Export', taskType: 'tiles-validation', maxAttempts: 7 },
    ]);
  });
});
