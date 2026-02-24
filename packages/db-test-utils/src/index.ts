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
} from './createWrapper.js';
// WASM location
export { locateWasmDir, wasmFilesExist } from './locateWasm.js';
export type {
  HarnessSqlClient,
  SeedFolderOptions,
  SeedHarnessAccountInput,
  SeedHarnessAccountResult,
  SeedVfsItemOptions
} from './seeding/index.js';
export type {
  HarnessActor,
  HarnessActorDefinition,
  HarnessActorsResult,
  HarnessGroup,
  HarnessGroupDefinition,
  HarnessGroupSeedInput,
  HarnessOrganization,
  HarnessOrganizationDefinition,
  HarnessOrganizationSeedInput,
  SeedVfsScenarioInput,
  SeedVfsScenarioResult
} from './seeding/index.js';

// Seeding utilities
export {
  buildPersonalOrganizationId,
  buildPersonalOrganizationName,
  buildRevenueCatAppUserId,
  buildVfsKeySetupFromPassword,
  classicTestMigrations,
  commonTestMigrations,
  contactsTestMigrations,
  createHarnessActors,
  createHarnessGroup,
  createHarnessOrganization,
  ensureVfsRoot,
  hashPassword,
  seedFolder,
  seedHarnessAccount,
  seedVfsItem,
  seedVfsLink,
  seedVfsScenario,
  VFS_ROOT_ID,
  vfsTestMigrations
} from './seeding/index.js';
// Key manager
export {
  createTestKeyManager,
  getTestKeyManager,
  resetTestKeyManager,
  TestKeyManager
} from './testKeyManager.js';
export type {
  Migration,
  TestDatabaseContext,
  WithRealDatabaseOptions
} from './withRealDatabase.js';
export {
  createTestDatabase,
  withRealDatabase
} from './withRealDatabase.js';
