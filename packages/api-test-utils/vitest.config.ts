import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.test.ts',
          'src/index.ts',
          // Integration-only utilities tested in @tearleads/bob-and-alice
          'src/testContext.ts',
          'src/seedTestUser.ts'
        ],
        thresholds: {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80
        }
      }
    }
  })
);
