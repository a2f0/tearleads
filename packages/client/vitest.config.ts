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
    exclude: ['tests/**/*', 'node_modules/**/*', 'src/**/*.integration.test.{ts,tsx}']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
