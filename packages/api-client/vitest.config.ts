import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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
      '@tearleads/local-write-orchestrator': fileURLToPath(
        new URL('../local-write-orchestrator/src/index.ts', import.meta.url)
      ),
      '@tearleads/msw/node': fileURLToPath(new URL('../msw/src/node.ts', import.meta.url)),
      '@tearleads/msw': fileURLToPath(new URL('../msw/src/index.ts', import.meta.url)),
      '@tearleads/shared': fileURLToPath(
        new URL('../shared/src/index.ts', import.meta.url)
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
});
