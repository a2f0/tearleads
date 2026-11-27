import type {
  DatabaseWorkerClient,
  WorkerLike,
} from "@tearleads/sqlite-worker/client";
import {
  type CreateModuleDatabaseRuntimeOptions,
  createDatabaseRuntime,
  type DatabaseRuntime,
  type ModuleWorkerConstructor,
  type ModuleWorkerLike,
} from "@tearleads/sqlite-worker/runtime";

export type SQLiteWorkerClient = DatabaseWorkerClient;
export type CreateSQLiteRuntimeOptions = CreateModuleDatabaseRuntimeOptions;
export type SQLiteRuntime = DatabaseRuntime;
export type SQLiteModuleWorkerConstructor = ModuleWorkerConstructor;
export type SQLiteModuleWorkerLike = ModuleWorkerLike;
export interface SQLiteRuntimeWorker extends WorkerLike {
  terminate(): void;
}

export {
  createModuleDatabaseRuntime as createSQLiteRuntime,
  DatabaseConnectionLostError,
  isDatabaseConnectionLostError,
} from "@tearleads/sqlite-worker/runtime";

export function createSQLiteRuntimeFromWorker(
  worker: SQLiteRuntimeWorker,
): SQLiteRuntime {
  return createDatabaseRuntime(worker);
}

export { purgeOpfsSqliteDatabase } from "@tearleads/sqlite-worker/purge-opfs-database";
export type { DatabasePersistenceMode } from "@tearleads/sqlite-worker/types";
export {
  type WipeOpfsStorageResult,
  wipeOpfsStorage,
} from "@tearleads/sqlite-worker/wipe-opfs-storage";
export {
  classifyDatabaseFailure,
  DATABASE_BUSY_RUN_LIMIT,
  type DatabaseFailureKind,
  retryWhileDatabaseBusy,
} from "../data/sqlite/availability/databaseBusyRetry";
export { isDatabaseTransactionBusyError } from "../data/sqlite/availability/databaseUnavailable";
export { clientSQLiteSchema } from "../data/sqlite/schema";
export {
  type ClientSQLiteDatabase as SQLiteDatabase,
  type ClientSQLitePersistenceRuntime as SQLitePersistenceRuntime,
  type ClientSQLiteTransactionScope as SQLiteTransaction,
  getClientSQLitePersistenceRuntime as getSQLitePersistenceRuntime,
} from "../data/sqlite/sqlitePersistenceRuntime";
export {
  assertRestorableLocalSchemaLedger,
  type ClientSqlMutationObserver,
  type ClientSqlStatementObserver,
  createExecSql,
  defineSqlTableSchema,
  type ExecSql,
  type ExecSqlClientLike,
  ensureLocalSchemaMigrated,
  ensureSqlTables,
  isLocalSchemaMigrationLockTimeoutError,
  LOCAL_SCHEMA_MIGRATION_LOCK_TIMEOUT_MESSAGE,
  LOCAL_SCHEMA_MIGRATION_LOCK_TIMEOUT_MS,
  LOCAL_SCHEMA_MIGRATIONS_TABLE,
  LocalSchemaMigrationLockTimeoutError,
  migrateLocalSchema,
  type ObservedClientSqlMutation,
  type ObservedClientSqlStatement,
  observeClientSqlMutations,
  observeClientSqlStatements,
  resetConnectionSchemaMemo,
  runSerializedSqlMutation,
  type SqlArrayRow,
  type SqlBind,
  type SqlRow,
  type SqlRowMode,
  type SqlRowValue,
  type SqlTableSchema,
  unavailableExecSql,
  withLocalSchemaMigrationLock,
} from "../data/sqlite/sqlSchema";
export {
  EPHEMERAL_STORAGE_POLICY,
  isPersistentStorageSupported,
  PERSISTENT_STORAGE_POLICY,
  type RequestPersistentStorageResult,
  requestPersistentStorage,
  resolveStoragePersistencePolicy,
  type StoragePersistencePolicy,
} from "../data/sqlite/storagePersistence";
