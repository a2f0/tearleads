import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      isolate: false,
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.test.ts',
          'src/index.ts',
          'src/**/index.ts'
        ],
        thresholds: {
          statements: 88,
          branches: 79,
          functions: 85,
          lines: 88
        }
      }
    },
    resolve: {
      alias: {
        '@tearleads/db/adapter': path.resolve(
          __dirname,
          '../db/src/adapter/index.ts'
        ),
        '@tearleads/shared': path.resolve(__dirname, '../shared/src/index.ts')
      }
    }
  })
);
