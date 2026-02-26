import { defineConfig, mergeConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { sharedTestConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
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
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80
        }
      }
    },
    resolve: {
      alias: {
        '@api-client': fileURLToPath(new URL('./src', import.meta.url)),
        '@tearleads/api-test-utils': fileURLToPath(
          new URL('../api-test-utils/src/index.ts', import.meta.url)
        ),
        '@tearleads/api/lib/postgres': fileURLToPath(
          new URL('../api/src/lib/postgres.ts', import.meta.url)
        ),
        '@tearleads/api/lib/redisPubSub': fileURLToPath(
          new URL('../api/src/lib/redisPubSub.ts', import.meta.url)
        ),
        '@tearleads/api/lib/jwt': fileURLToPath(
          new URL('../api/src/lib/jwt.ts', import.meta.url)
        ),
        '@tearleads/api/migrations': fileURLToPath(
          new URL('../api/src/migrations/index.ts', import.meta.url)
        ),
        '@tearleads/api': fileURLToPath(
          new URL('../api/src/index.ts', import.meta.url)
        ),
        '@tearleads/local-write-orchestrator': fileURLToPath(
          new URL('../local-write-orchestrator/src/index.ts', import.meta.url)
        ),
        '@tearleads/msw/node': fileURLToPath(new URL('../msw/src/node.ts', import.meta.url)),
        '@tearleads/msw': fileURLToPath(new URL('../msw/src/index.ts', import.meta.url)),
        '@tearleads/shared/redis': fileURLToPath(
          new URL('../shared/src/redis/index.ts', import.meta.url)
        ),
        '@tearleads/shared/testing': fileURLToPath(
          new URL('../shared/src/testing/index.ts', import.meta.url)
        ),
        '@tearleads/shared': fileURLToPath(
          new URL('../shared/src/index.ts', import.meta.url)
        ),
        '@tearleads/db/migrations': fileURLToPath(
          new URL('../db/src/migrations/index.ts', import.meta.url)
        ),
        '@tearleads/shared/package.json': fileURLToPath(
          new URL('../shared/package.json', import.meta.url)
        ),
        '@tearleads/vfs-sync/vfs': fileURLToPath(
          new URL('../vfs-sync/src/vfs/index.ts', import.meta.url)
        ),
        '@tearleads/vfs-sync': fileURLToPath(
          new URL('../vfs-sync/src/index.ts', import.meta.url)
        ),
        '@tearleads/msw/package.json': fileURLToPath(
          new URL('../msw/package.json', import.meta.url)
        )
      }
    }
  })
);
