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
export type CreateModuleSQLiteRuntimeOptions = CreateSQLiteRuntimeOptions;
export type SQLiteRuntime = DatabaseRuntime;
export type SQLiteModuleWorkerConstructor = ModuleWorkerConstructor;
export type SQLiteModuleWorkerLike = ModuleWorkerLike;
export interface SQLiteRuntimeWorker extends WorkerLike {
  terminate(): void;
}

function isSQLiteRuntimeWorker(
  value: CreateSQLiteRuntimeOptions | SQLiteRuntimeWorker | undefined,
): value is SQLiteRuntimeWorker {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "terminate") === "function" &&
    typeof Reflect.get(value, "postMessage") === "function" &&
    typeof Reflect.get(value, "addEventListener") === "function" &&
    typeof Reflect.get(value, "removeEventListener") === "function"
  );
}

export function createSQLiteRuntime(
  options?: CreateSQLiteRuntimeOptions,
): SQLiteRuntime;
export function createSQLiteRuntime(worker: SQLiteRuntimeWorker): SQLiteRuntime;
export function createSQLiteRuntime(
  input?: CreateSQLiteRuntimeOptions | SQLiteRuntimeWorker,
): SQLiteRuntime {
  return isSQLiteRuntimeWorker(input)
    ? createDatabaseRuntime(input)
    : createModuleDatabaseRuntime(input);
}

export function createModuleSQLiteRuntime(
  options?: CreateModuleSQLiteRuntimeOptions,
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
