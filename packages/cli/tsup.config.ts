import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle workspace dependencies
  noExternal: ['@tearleads/shared'],
  // Keep native modules external (can't be bundled)
  external: ['better-sqlite3-multiple-ciphers']
});
