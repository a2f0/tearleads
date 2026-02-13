import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.integration.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.integration.test.{ts,tsx}',
        'src/test/**/*',
        'src/index.ts',
        'src/**/index.ts'
      ],
      thresholds: {
        statements: 93,
        branches: 85,
        functions: 95,
        lines: 95
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../client/src', import.meta.url)),
      '@client': fileURLToPath(new URL('../client/src', import.meta.url)),
      '@admin': fileURLToPath(new URL('./src', import.meta.url)),
      '@tearleads/window-manager': fileURLToPath(
        new URL('../window-manager/src/index.ts', import.meta.url)
      )
    }
  }
});
