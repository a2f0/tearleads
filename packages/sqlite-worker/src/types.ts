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
}

export type WorkerMethod = keyof WorkerRequestMap;

export type WorkerRequest<K extends WorkerMethod = WorkerMethod> = K extends WorkerMethod
  ? {
      id: number;
      method: K;
      params: WorkerRequestMap[K]["params"];
    }
  : never;

export type WorkerResponse<K extends WorkerMethod = WorkerMethod> = K extends WorkerMethod
  ? {
      id: number;
      result: DatabaseWorkerResult<WorkerRequestMap[K]["result"]>;
    }
  : never;
