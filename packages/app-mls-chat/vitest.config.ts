import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@tearleads/mls-core': path.resolve(dirname, '../mls-core/src/index.ts')
      }
    },
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
          'src/**/index.ts'
        ],
        thresholds: {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        }
      }
    }
  })
);
