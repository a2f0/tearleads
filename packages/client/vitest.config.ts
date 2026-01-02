import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Include both unit tests and integration tests.
    // Integration tests use SQLite WASM (no native module compilation needed).
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.integration.test.{ts,tsx}'],
    exclude: ['tests/**/*', 'node_modules/**/*'],
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
        'src/vite-env.d.ts',
        // LLM files are excluded because they rely on web workers and WebGPU
        // which require integration/e2e testing rather than unit tests
        'src/workers/llm-worker.ts',
        'src/hooks/useLLM.ts',
        'src/lib/llm-runtime.ts'
      ],
      thresholds: {
        statements: 63,
        branches: 65,
        functions: 69,
        lines: 64
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
