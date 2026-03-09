import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    define: {
      __APP_VERSION__: JSON.stringify('0.0.1')
    },
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
          'src/lib/analyticsState.ts',
          'src/lib/analyticsEvents.ts'
        ],
        thresholds: {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        }
      }
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/test/clientCompat', import.meta.url)),
        '@analytics': fileURLToPath(new URL('./src', import.meta.url)),
        '@tearleads/db/sqlite': fileURLToPath(
          new URL('../db/src/generated/sqlite/schema.ts', import.meta.url)
        ),
        '@tearleads/db/adapter': fileURLToPath(
          new URL('../db/src/adapter/index.ts', import.meta.url)
        ),
        '@tearleads/shared': fileURLToPath(
          new URL('../shared/src/index.ts', import.meta.url)
        ),
        '@tearleads/ui': fileURLToPath(new URL('../ui/src/index.ts', import.meta.url))
      }
    }
  })
);
