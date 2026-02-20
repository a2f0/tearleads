import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/test/**/*'],
      thresholds: {
        statements: 88,
        branches: 75,
        functions: 100,
        lines: 88
      }
    }
  }
});
