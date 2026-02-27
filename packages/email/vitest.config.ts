import { defineConfig, mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['node_modules', 'dist'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/test/**/*',
          'src/index.ts',
          'src/**/index.ts',
          'src/persistence/**/*',
          'src/components/compose/**/*',
          'src/hooks/useCompose.ts',
          'src/types/compose.ts'
        ],
        // TODO: Increase coverage thresholds by adding tests for
        // persistence, compose components, and useCompose hook
        thresholds: {
          statements: 85,
          branches: 75,
          functions: 80,
          lines: 85
        }
      }
    }
  })
);
