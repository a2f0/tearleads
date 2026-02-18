import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
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
      '@tearleads/api-client/authStorage': fileURLToPath(
        new URL('../api-client/src/authStorage.ts', import.meta.url)
      ),
      '@tearleads/api-client': fileURLToPath(
        new URL('../api-client/src/index.ts', import.meta.url)
      ),
      '@sync': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
