import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      environment: 'node',
      globals: true,
      include: ['src/**/*.test.ts'],
      exclude: ['node_modules', 'dist'],
      testTimeout: 30_000,
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
          statements: 75,
          branches: 60,
          functions: 75,
          lines: 75
        }
      }
    },
    resolve: {
      alias: {
        '@tearleads/api/migrations': fileURLToPath(
          new URL('../api/src/migrations/index.ts', import.meta.url)
        ),
        '@tearleads/api': fileURLToPath(
          new URL('../api/src/index.ts', import.meta.url)
        )
      }
    }
  })
);
