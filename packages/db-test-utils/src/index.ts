// Core utilities

export type { Database } from '@tearleads/db/sqlite';
// Re-export schema for convenience
export { schema } from '@tearleads/db/sqlite';
export type {
  DatabaseAdapter,
  DatabaseConfig,
  JsonBackupData,
  QueryResult,
  WasmNodeAdapterOptions
} from './adapters/index.js';

// Adapters
export {
  convertRowsToArrays,
  extractSelectColumns,
  rowToArray,
  WasmNodeAdapter
} from './adapters/index.js';
// React wrapper
export {
  composeWrappers,
  createRealDbWrapper,
  useTestDb
} from './create-wrapper.js';
// WASM location
export { locateWasmDir, wasmFilesExist } from './locate-wasm.js';
export type { SeedFolderOptions, SeedVfsItemOptions } from './seeding/index.js';

// Seeding utilities
export {
  commonTestMigrations,
  contactsTestMigrations,
  ensureVfsRoot,
  seedFolder,
  seedVfsItem,
  seedVfsLink,
  VFS_ROOT_ID,
  vfsTestMigrations
} from './seeding/index.js';
// Key manager
export {
  createTestKeyManager,
  getTestKeyManager,
  resetTestKeyManager,
  TestKeyManager
} from './test-key-manager.js';
export type {
  Migration,
  TestDatabaseContext,
  WithRealDatabaseOptions
} from './with-real-database.js';
export {
  createTestDatabase,
  withRealDatabase
} from './with-real-database.js';
