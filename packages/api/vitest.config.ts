import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    resolve: {
      alias: {
        // Mock @tearleads/db/package.json for tests
        '@tearleads/db/package.json': path.resolve(
          __dirname,
          '../../packages/db/package.json'
        )
      }
    },
    test: {
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.test.ts',
          'src/types/**/*',
          'src/cli/**/*',
          'src/apiCli.ts',
          // TODO: Add proper tests for MLS routes - excluded temporarily
          'src/routes/mls.ts',
          'src/routes/mls/**/*.ts'
        ],
        thresholds: {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90
        }
      }
    }
  })
);
