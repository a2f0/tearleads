import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createAppConfigPlugin } from '../app-builder/src/vite/createAppConfigPlugin';
import { sharedTestConfig } from '../../vitest.shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize app config plugin for virtual module support in tests
const { plugin: appConfigPlugin } = createAppConfigPlugin(__dirname);

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    plugins: [appConfigPlugin, react()],
    test: {
      environment: 'happy-dom',
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
    }
  })
);
