import type {
  DatabaseWorkerClient,
  WorkerLike,
} from "@symcrypt/sqlite-worker/client";
import {
  type CreateModuleDatabaseRuntimeOptions,
  createDatabaseRuntime,
  type DatabaseRuntime,
  type ModuleWorkerConstructor,
  type ModuleWorkerLike,
} from "@symcrypt/sqlite-worker/runtime";

export type SQLiteWorkerClient = DatabaseWorkerClient;
export type CreateSQLiteRuntimeOptions = CreateModuleDatabaseRuntimeOptions;
export type SQLiteRuntime = DatabaseRuntime;
export type SQLiteModuleWorkerConstructor = ModuleWorkerConstructor;
export type SQLiteModuleWorkerLike = ModuleWorkerLike;
export interface SQLiteRuntimeWorker extends WorkerLike {
  terminate(): void;
}

export { createModuleDatabaseRuntime as createSQLiteRuntime } from "@symcrypt/sqlite-worker/runtime";

export function createSQLiteRuntimeFromWorker(
  worker: SQLiteRuntimeWorker,
): SQLiteRuntime {
  return createDatabaseRuntime(worker);
}

export { purgeOpfsSqliteDatabase } from "@symcrypt/sqlite-worker/purge-opfs-database";
export type { DatabasePersistenceMode } from "@symcrypt/sqlite-worker/types";
export { clientSQLiteSchema } from "./data/sqlite/schema";
export {
  type ClientSQLiteDatabase as SQLiteDatabase,
  type ClientSQLitePersistenceRuntime as SQLitePersistenceRuntime,
  type ClientSQLiteTransactionScope as SQLiteTransaction,
  getClientSQLitePersistenceRuntime as getSQLitePersistenceRuntime,
} from "./data/sqlite/sqlitePersistenceRuntime";
export {
  createExecSql,
  defineSqlTableSchema,
  type ExecSql,
  type ExecSqlClientLike,
  ensureSqlTables,
  resetConnectionSchemaMemo,
  runSerializedSqlMutation,
  type SqlArrayRow,
  type SqlBind,
  type SqlRow,
  type SqlRowMode,
  type SqlRowValue,
  type SqlTableSchema,
  unavailableExecSql,
} from "./data/sqlite/sqlSchema";
export {
  EPHEMERAL_STORAGE_POLICY,
  isPersistentStorageSupported,
  PERSISTENT_STORAGE_POLICY,
  type RequestPersistentStorageResult,
  requestPersistentStorage,
  resolveStoragePersistencePolicy,
  type StoragePersistencePolicy,
} from "./data/sqlite/storagePersistence";
