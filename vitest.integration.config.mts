import { defineConfig, type ViteUserConfig } from 'vitest/config';
import path from 'path';
import tsconfig from './tsconfig.json';

const pathAlias = Object.fromEntries(
  Object.entries(tsconfig.compilerOptions.paths).map(([key, [value]]) => [key.replace('/*', ''), path.resolve(__dirname, value.replace('/*', ''))])
);

const reporters: Exclude<ViteUserConfig['test'], undefined>['reporters'] = ['default'];
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
    include: ['tests/integration/**/*.integration.spec.ts'],
    environment: 'node',
    reporters,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
