import type {
  DatabaseWorkerClient,
  WorkerLike,
} from "@tearleads/sqlite-worker/client";
import {
  type CreateModuleDatabaseRuntimeOptions,
  createDatabaseRuntime,
  createModuleDatabaseRuntime,
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

export function createSQLiteRuntime(
  options?: CreateSQLiteRuntimeOptions,
): SQLiteRuntime {
  return createModuleDatabaseRuntime(options);
}

export function createSQLiteRuntimeFromWorker(
  worker: SQLiteRuntimeWorker,
): SQLiteRuntime {
  return createDatabaseRuntime(worker);
}

export { purgeOpfsSqliteDatabase } from "@tearleads/sqlite-worker/purge-opfs-database";
export type { DatabasePersistenceMode } from "@tearleads/sqlite-worker/types";
export { clientSQLiteSchema } from "./data/sqlite/schema";
export {
  type ClientSQLiteDatabase as SQLiteDatabase,
  type ClientSQLitePersistenceRuntime as SQLitePersistenceRuntime,
  type ClientSQLiteTransaction as SQLiteTransaction,
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
