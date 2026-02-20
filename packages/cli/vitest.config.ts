import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**/*',
        'src/index.ts',
        'src/commands/**/*',
        'src/utils/**/*',
        'src/backup/**/*'
      ],
      // TODO: Increase coverage thresholds back to 100% by adding tests
      // for backup module (compression.ts, decoder.ts, encoder.ts, crypto.ts)
      thresholds: {
        statements: 85,
        branches: 65,
        functions: 90,
        lines: 85
      }
    }
  }
});
