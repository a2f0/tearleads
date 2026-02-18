import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { createAppConfigPlugin } from '../client/vite-plugin-app-config';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize app config plugin for virtual module support in tests
const { plugin: appConfigPlugin } = createAppConfigPlugin(resolve(__dirname, '../client'));

export default defineConfig({
  plugins: [appConfigPlugin, react()],
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
        // Baseline thresholds from extracted help package coverage.
        statements: 85.2,
        branches: 76.6,
        functions: 78.3,
        lines: 87.9
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../client/src', import.meta.url)),
      '@client': fileURLToPath(new URL('../client/src', import.meta.url)),
      '@help': fileURLToPath(new URL('./src', import.meta.url)),
      '@tearleads/api/dist/openapi.json': fileURLToPath(
        new URL('../api/dist/openapi.json', import.meta.url)
      )
    }
  }
});
