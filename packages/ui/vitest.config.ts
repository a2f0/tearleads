import { defineConfig, mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const sharedTestConfig = {
  test: {
    pool: 'threads' as const,
    deps: { optimizer: { client: { enabled: true }, ssr: { enabled: true } } },
  },
};

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    plugins: [react()],
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
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**/*', 'src/index.ts'],
        thresholds: {
          // Baseline thresholds after package extraction/decoupling.
          statements: 74,
          branches: 71,
          functions: 76,
          lines: 75
        }
      }
    }
  })
);
