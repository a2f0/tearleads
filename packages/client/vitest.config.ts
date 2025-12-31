import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Exclude integration tests from normal test runs.
    // Integration tests use better-sqlite3-multiple-ciphers which requires
    // native module compilation and is only available in dev environments.
    // Run integration tests locally with: pnpm test -- --include '**/*.integration.test.tsx'
    exclude: ['tests/**/*', 'node_modules/**/*', 'src/**/*.integration.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.integration.test.{ts,tsx}',
        'src/test/**/*',
        'src/types/**/*',
        'src/main.tsx',
        'src/vite-env.d.ts'
      ],
      thresholds: {
        statements: 47,
        branches: 50,
        functions: 49,
        lines: 47
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
