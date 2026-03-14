import { defineConfig } from 'vitest/config';
import { vitestMaxWorkers } from './vitest.shared';

export default defineConfig({
  test: {
    projects: [
      'packages/api-client',
      'packages/cli',
      'packages/client',
      'packages/ui',
    ],
    // Keep workspace runs from saturating high-core laptops while preserving
    // parallel execution.
    maxWorkers: vitestMaxWorkers,
  },
});
