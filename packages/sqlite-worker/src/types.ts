export type CipherName =
  | "sqlcipher"
  | "chacha20"
  | "aes128cbc"
  | "aes256cbc"
  | "ascon128";

/**
 * Where the database file lives.
 *
 * - `"memory"`: transient in-memory database (the historical default). Wiped on
 *   every reload / worker restart.
 * - `"opfs-sahpool"`: persistent database backed by the OPFS SyncAccessHandle
 *   Pool VFS. Survives reloads (including hard / shift+reload) because the bytes
 *   live in the Origin Private File System, not in the worker heap or the HTTP
 *   cache. Requires neither `SharedArrayBuffer` nor COOP/COEP headers.
 *
 * When `"opfs-sahpool"` is requested but OPFS is unavailable (or the VFS fails
 * to install), `initDatabase` throws rather than silently degrading to memory —
 * persistence is opt-in and a missing backend is treated as a hard error.
 */
export type DatabasePersistenceMode = "memory" | "opfs-sahpool";

export interface DatabaseWorkerInitOptions {
  dbName: string;
  cipher: CipherName;
  key: string;
  /**
   * Storage backend for the database. Defaults to `"memory"` to preserve the
   * historical behavior for callers that do not opt into persistence.
   */
  persistence?: DatabasePersistenceMode;
}

export type SqliteBindValue = string | number | null;
export type SqliteBind =
  | Record<string, SqliteBindValue>
  | ReadonlyArray<SqliteBindValue>;
export type SqliteRowMode = "object" | "array";
export type SqliteObjectRow = Record<string, SqliteBindValue>;
export type SqliteArrayRow = SqliteBindValue[];
export type SqliteRow = SqliteObjectRow | SqliteArrayRow;

export interface DatabaseWorkerExecOptions {
  sql: string;
  bind?: SqliteBind;
  rowMode?: SqliteRowMode;
}

export interface DatabaseWorkerExecResult {
  ok: true;
  rows: SqliteRow[];
}

export interface DatabaseWorkerReady {
  ok: true;
}

export interface DatabaseWorkerClosed {
  ok: true;
}

export interface DatabaseWorkerDeleted {
  ok: true;
}

export interface DatabaseWorkerPingResult {
  ok: true;
  message: "pong";
}

export interface DatabaseWorkerError {
  ok: false;
  message: string;
}

export type DatabaseWorkerResult<T> = T | DatabaseWorkerError;

export interface WorkerRequestMap {
  ping: {
    params: undefined;
    result: DatabaseWorkerPingResult;
  };
  init: {
    params: DatabaseWorkerInitOptions;
    result: DatabaseWorkerReady;
  };
  exec: {
    params: DatabaseWorkerExecOptions;
    result: DatabaseWorkerExecResult;
  };
  // Graceful shutdown: close the db and release the persistent VFS's OPFS access
  // handles before the worker is terminated, so the next worker (reload / other
  // tab) can acquire them without losing the SAHPool lock-contention race.
  close: {
    params: undefined;
    result: DatabaseWorkerClosed;
  };
  // Destructive shutdown: close the db and WIPE the persistent VFS's OPFS files
  // (not merely release the handles). Used to forget local data on logout.
  delete: {
    params: undefined;
    result: DatabaseWorkerDeleted;
  };
}

export const WORKER_CONNECT_PORT_MESSAGE_TYPE = "symcrypt:sqlite-connect-port";
export const WORKER_DISCONNECT_PORT_MESSAGE_TYPE =
  "symcrypt:sqlite-disconnect-port";
export const WORKER_PORT_DISCONNECTED_MESSAGE_TYPE =
  "symcrypt:sqlite-port-disconnected";

export type WorkerMethod = keyof WorkerRequestMap;

export type WorkerRequest<K extends WorkerMethod = WorkerMethod> =
  K extends WorkerMethod
    ? {
        id: number;
        method: K;
        params: WorkerRequestMap[K]["params"];
      }
    : never;

export type WorkerResponse<K extends WorkerMethod = WorkerMethod> =
  K extends WorkerMethod
    ? {
        id: number;
        result: DatabaseWorkerResult<WorkerRequestMap[K]["result"]>;
      }
    : never;
