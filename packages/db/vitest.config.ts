import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
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
          'src/index.ts',
          'src/**/index.ts',
          'src/generated/**/*',
          // Migration runner and types are tested via @tearleads/api-test-utils
          // integration tests that exercise runMigrations with a real PGlite pool.
          'src/migrations/**/*',
          // SQLite migration definitions without direct unit tests (v001-v010, v019, v021)
          // are exercised by client integration tests. Only tested definitions are counted.
          'src/sqlite-migrations/v0[0-1][0-9].ts',
          'src/sqlite-migrations/v019.ts',
          'src/sqlite-migrations/v021.ts',
          'src/sqlite-migrations/types.ts'
        ],
        thresholds: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100
        }
      }
    }
  })
);
