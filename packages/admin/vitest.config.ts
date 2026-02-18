import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
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
      '@tearleads/api-client/authStorage': fileURLToPath(
        new URL('../api-client/src/authStorage.ts', import.meta.url)
      ),
      '@tearleads/api-client': fileURLToPath(
        new URL('../api-client/src/index.ts', import.meta.url)
      ),
      '@tearleads/compliance': fileURLToPath(
        new URL('../compliance/src/index.ts', import.meta.url)
      ),
      '@tearleads/window-manager': fileURLToPath(
        new URL('../window-manager/src/index.ts', import.meta.url)
      )
    }
  }
});
