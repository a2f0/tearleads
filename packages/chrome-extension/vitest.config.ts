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
        exclude: ['src/**/*.test.ts'],
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
