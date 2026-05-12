import { defineConfig, ViteUserConfig } from 'vitest/config';
import tsconfig from './tsconfig.json';
import path from 'path';

// Create an alias object from the paths in tsconfig.json
const pathAlias = Object.fromEntries(
  // For Each Path in tsconfig.json
  Object.entries(tsconfig.compilerOptions.paths).map(([key, [value]]) => [
    // Remove the "/*" from the key and resolve the path
    key.replace('/*', ''),
    // Remove the "/*" from the value Resolve the relative path
    path.resolve(__dirname, value.replace('/*', '')),
  ])
);

const reporters: Exclude<ViteUserConfig['test'], undefined>['reporters'] = ['default', 'html'];

if (process.env.GITHUB_ACTIONS) {
  reporters.push('github-actions');
}

export default defineConfig({
  resolve: {
    alias: {
      ...pathAlias,
      '@map-colonies/raster-shared': path.resolve(__dirname, 'node_modules/@map-colonies/raster-shared/dist/index.js'),
    },
  },
  test: {
    setupFiles: ['./tests/setup/vite.setup.ts'],
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/**/*.integration.spec.ts'],
    environment: 'node',
    reporters,

    coverage: {
      enabled: true,
      reporter: ['text', 'html', 'json', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/vendor/**',
        'node_modules/**',
        // Application entry points
        'src/index.ts',
        'src/worker.ts',
        // DI wiring and bootstrap — integration concerns, not unit concerns
        'src/containerConfig.ts',
        'src/common/dependencyRegistration.ts',
        'src/common/config.ts',
        'src/common/tracing.ts',
        'src/worker/workerBuilder.ts',
        // Pure TypeScript interfaces — no executable code
        'src/cleaner/types.ts',
        'src/cleaner/strategies/taskStrategy.ts',
        'src/common/interfaces.ts',
        'src/cleaner/storageProviders/iStorageProvider.ts',
        // Barrel re-export files
        'src/cleaner/storageProviders/index.ts',
      ],
      reportOnFailure: true,
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
