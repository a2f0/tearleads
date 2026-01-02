import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest configuration for integration tests.
 *
 * Integration tests use better-sqlite3-multiple-ciphers for real SQLite I/O.
 * This requires native module compilation, so these tests only run in
 * development environments with proper build tools installed.
 *
 * Run with: pnpm test:integration
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Only run integration tests
    include: ['src/**/*.integration.test.{ts,tsx}'],
    exclude: ['tests/**/*', 'node_modules/**/*']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
