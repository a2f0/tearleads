import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/server.ts'],
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
