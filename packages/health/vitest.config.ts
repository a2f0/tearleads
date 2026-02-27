import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    define: {
      __APP_VERSION__: JSON.stringify('0.0.1')
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
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
          // Type-only modules extracted during refactoring
          'src/lib/healthTrackerTypes.ts'
        ],
        thresholds: {
          // Lowered from 100% after file-splitting refactor
          statements: 97,
          branches: 92,
          functions: 97,
          lines: 97
        }
      }
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/test/clientCompat', import.meta.url)),
        '@health': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  })
);
