import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: [
          'src/**/*.test.ts',
          'src/**/*.test.tsx',
          'src/index.ts',
          'src/**/index.ts',
          'src/test/**/*',
          'src/adapters/types.ts',
          // Type definitions extracted during refactoring
          'src/adapters/wasmNodeTypes.ts'
        ],
        thresholds: {
          statements: 85,
          branches: 75,
          functions: 90,
          lines: 85
        }
      }
    }
  })
);
