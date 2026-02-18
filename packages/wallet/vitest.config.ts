import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
        'src/**/index.ts'
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
      '@': fileURLToPath(new URL('../client/src', import.meta.url)),
      '@client': fileURLToPath(new URL('../client/src', import.meta.url)),
      '@wallet': fileURLToPath(new URL('./src', import.meta.url)),
      '@tearleads/api-client/authStorage': fileURLToPath(
        new URL('../api-client/src/authStorage.ts', import.meta.url)
      ),
      '@tearleads/api-client': fileURLToPath(
        new URL('../api-client/src/index.ts', import.meta.url)
      ),
      '@tearleads/window-manager': fileURLToPath(
        new URL('../window-manager/src/index.ts', import.meta.url)
      )
    }
  }
});
