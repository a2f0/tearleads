import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
      setupFiles: ['src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/test/**/*'],
        // TODO: Increase branch coverage to 85% by adding tests for
        // teeClient.ts error handling paths
        thresholds: {
          statements: 88,
          branches: 75,
          functions: 100,
          lines: 88
        }
      }
    }
  })
);
