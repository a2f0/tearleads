import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createAppConfigPlugin } from '../app-builder/src/vite/createAppConfigPlugin';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize app config plugin for virtual module support in tests
const { plugin: appConfigPlugin } = createAppConfigPlugin(__dirname);

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
        'src/**/index.ts',
        'src/i18n/translations/types.ts'
      ],
      thresholds: {
        // Baseline thresholds after package extraction/decoupling.
        statements: 90,
        branches: 80,
        functions: 92,
        lines: 92
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@admin': fileURLToPath(new URL('./src', import.meta.url)),
      '@tearleads/compliance': fileURLToPath(
        new URL('../compliance/src/index.ts', import.meta.url)
      ),
      '@tearleads/window-manager': fileURLToPath(
        new URL('../window-manager/src/index.ts', import.meta.url)
      )
    }
  }
});
