import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    // Run test files sequentially across workspace projects to prevent
    // CPU saturation. Without this, vitest spawns a thread pool per
    // project (~48 packages) which can use 1500%+ CPU.
    fileParallelism: false,
  },
});
