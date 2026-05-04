export type CipherName =
  | "sqlcipher"
  | "chacha20"
  | "aes128cbc"
  | "aes256cbc"
  | "ascon128";

export interface DatabaseWorkerInitOptions {
  dbName: string;
  cipher: CipherName;
  key: string;
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

export interface DatabaseWorkerError {
  ok: false;
  message: string;
}

export type DatabaseWorkerResult<T> = T | DatabaseWorkerError;

export interface WorkerRequestMap {
  ping: {
    params: undefined;
    result: { ok: true; message: "pong" };
  };
  init: {
    params: DatabaseWorkerInitOptions;
    result: DatabaseWorkerReady;
  };
  exec: {
    params: DatabaseWorkerExecOptions;
    result: DatabaseWorkerExecResult;
  };
}

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
