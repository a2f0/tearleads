import type { SQLiteRuntime } from "@symcrypt/client-sdk/sqlite";

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

/** Fails its first init, then succeeds — exercises boot retry after a failure. */
export function createRetryableSQLiteRuntimeFactory() {
  let createCount = 0;
  let initCount = 0;
  let destroyCount = 0;

  return {
    createSQLiteRuntime: (): SQLiteRuntime => {
      createCount += 1;
      const runtimeId = `runtime-${createCount}`;
      const client: SQLiteRuntime["client"] = {
        close: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
        destroy() {
          destroyCount += 1;
        },
        exec: async () => ({ ok: true, rows: [] }),
        init: async () => {
          initCount += 1;
          if (initCount === 1) {
            throw new Error("planned sqlite init failure");
          }

          return { ok: true };
        },
        ping: async () => ({ ok: true, message: "pong" }),
      };

      return {
        client,
        deleteData: async () => client.destroy(),
        destroy: () => client.destroy(),
        id: runtimeId,
        terminateNow: () => client.destroy(),
      };
    },
    getStats: () => ({ createCount, destroyCount, initCount }),
  };
}

/** One reusable worker whose first init can be held to exercise target races. */
export function createReusableSQLiteRuntimeFactory(options?: {
  closeError?: Error;
  deferClose?: boolean;
  deferDelete?: boolean;
  deferFirstInit?: boolean;
  deferSecondInit?: boolean;
  deleteError?: Error;
  firstExecError?: Error;
  firstInitError?: Error;
}) {
  const firstInit = createDeferred();
  const secondInit = createDeferred();
  const closeGate = createDeferred();
  const deleteGate = createDeferred();
  let createCount = 0;
  let renewCount = 0;
  let initCount = 0;
  let execCount = 0;
  let closeCount = 0;
  let clientDeleteCount = 0;
  let deleteDataCount = 0;
  let clientDestroyCount = 0;
  let terminateCount = 0;
  let clientGeneration = 0;
  const initializedDbNames: string[] = [];

  if (!options?.deferFirstInit) {
    firstInit.resolve();
  }
  if (!options?.deferSecondInit) {
    secondInit.resolve();
  }
  if (!options?.deferClose) {
    closeGate.resolve();
  }
  if (!options?.deferDelete) {
    deleteGate.resolve();
  }

  return {
    createSQLiteRuntime: (): SQLiteRuntime & { renewClient(): void } => {
      createCount += 1;
      let terminated = false;
      let runtimeId = "";
      let client: SQLiteRuntime["client"];

      const createClient = (): SQLiteRuntime["client"] => {
        clientGeneration += 1;
        runtimeId = `reusable-${clientGeneration}`;
        return {
          close: async () => {
            closeCount += 1;
            await closeGate.promise;
            if (options?.closeError) {
              throw options.closeError;
            }
            return { ok: true };
          },
          delete: async () => {
            clientDeleteCount += 1;
            await deleteGate.promise;
            if (options?.deleteError) {
              throw options.deleteError;
            }
            return { ok: true };
          },
          destroy() {
            clientDestroyCount += 1;
          },
          exec: async () => {
            execCount += 1;
            if (execCount === 1 && options?.firstExecError) {
              throw options.firstExecError;
            }
            return { ok: true, rows: [] };
          },
          init: async ({ dbName }) => {
            initCount += 1;
            initializedDbNames.push(dbName);
            if (initCount === 1) {
              await firstInit.promise;
              if (options?.firstInitError) {
                throw options.firstInitError;
              }
            } else if (initCount === 2) {
              await secondInit.promise;
            }
            return { ok: true };
          },
          ping: async () => ({ ok: true, message: "pong" }),
        };
      };

      client = createClient();
      const terminate = () => {
        if (terminated) {
          return;
        }
        terminated = true;
        terminateCount += 1;
        client.destroy();
      };

      return {
        get client() {
          return client;
        },
        deleteData: async () => {
          deleteDataCount += 1;
          terminate();
        },
        destroy: terminate,
        get id() {
          return runtimeId;
        },
        renewClient() {
          if (terminated) {
            return;
          }
          renewCount += 1;
          client.destroy();
          client = createClient();
        },
        terminateNow: terminate,
      };
    },
    getStats: () => ({
      clientDestroyCount,
      clientDeleteCount,
      closeCount,
      createCount,
      deleteDataCount,
      initCount,
      initializedDbNames: [...initializedDbNames],
      renewCount,
      terminateCount,
    }),
    releaseClose: () => closeGate.resolve(),
    releaseDelete: () => deleteGate.resolve(),
    releaseFirstInit: () => firstInit.resolve(),
    releaseSecondInit: () => secondInit.resolve(),
  };
}

/**
 * Fails `init` with a boot round-trip *timeout* error (the marker
 * `isBootRoundTripTimeoutError` matches) the first `failureCount` times, then
 * succeeds. Exercises the transient-boot-failure auto-recovery: the managed
 * runtime should tear the stuck worker down and re-spawn a fresh one instead of
 * surfacing an error. Pass `Number.POSITIVE_INFINITY` to always fail and exercise
 * the re-spawn cap.
 */
export function createBootTimeoutSQLiteRuntimeFactory(failureCount: number) {
  let createCount = 0;
  let initCount = 0;
  let destroyCount = 0;

  return {
    createSQLiteRuntime: (): SQLiteRuntime => {
      createCount += 1;
      const runtimeId = `runtime-${createCount}`;
      const client: SQLiteRuntime["client"] = {
        close: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
        destroy() {
          destroyCount += 1;
        },
        exec: async () => ({ ok: true, rows: [] }),
        init: async () => {
          initCount += 1;
          if (initCount <= failureCount) {
            // Starts with the "SQLite boot round-trip" marker so the managed
            // runtime treats it as a transient teardown/respawn race.
            throw new Error(
              "SQLite boot round-trip: database initialization timed out after 15000ms.",
            );
          }

          return { ok: true };
        },
        ping: async () => ({ ok: true, message: "pong" }),
      };

      return {
        client,
        deleteData: async () => client.destroy(),
        destroy: () => client.destroy(),
        id: runtimeId,
        terminateNow: () => client.destroy(),
      };
    },
    getStats: () => ({ createCount, destroyCount, initCount }),
  };
}

/** Records the options each init() is called with (cipher key, persistence). */
export function createRecordingSQLiteRuntimeFactory() {
  const initOptions: Array<Parameters<SQLiteRuntime["client"]["init"]>[0]> = [];

  return {
    createSQLiteRuntime: (): SQLiteRuntime => {
      const client: SQLiteRuntime["client"] = {
        close: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
        destroy() {},
        exec: async () => ({ ok: true, rows: [] }),
        init: async (options) => {
          initOptions.push(options);
          return { ok: true };
        },
        ping: async () => ({ ok: true, message: "pong" }),
      };

      return {
        client,
        deleteData: async () => client.destroy(),
        destroy: () => client.destroy(),
        id: "recording",
        terminateNow: () => client.destroy(),
      };
    },
    getInitOptions: () => initOptions,
  };
}

/** Models a close that blocks until delete()/releaseClose() — for kill/respawn. */
export function createRestartSensitiveSQLiteRuntimeFactory() {
  let createCount = 0;
  let initCount = 0;
  let closeCount = 0;
  let terminateCount = 0;
  let databaseLocked = false;
  let pendingClose: Deferred | null = null;

  return {
    createSQLiteRuntime: (): SQLiteRuntime => {
      createCount += 1;
      const runtimeId = `restart-sensitive-${createCount}`;
      let initialized = false;
      let terminated = false;
      const client: SQLiteRuntime["client"] = {
        close: async () => {
          closeCount += 1;
          if (!initialized) {
            return { ok: true };
          }

          const close = createDeferred();
          pendingClose = close;
          await close.promise;
          return { ok: true };
        },
        delete: async () => {
          databaseLocked = false;
          pendingClose?.resolve();
          pendingClose = null;
          return { ok: true };
        },
        destroy() {
          terminateCount += 1;
        },
        exec: async () => ({ ok: true, rows: [] }),
        init: async () => {
          initCount += 1;
          if (databaseLocked) {
            throw new Error("database is still closing");
          }

          databaseLocked = true;
          initialized = true;
          return { ok: true };
        },
        ping: async () => ({ ok: true, message: "pong" }),
      };
      const terminate = () => {
        if (terminated) {
          return;
        }

        terminated = true;
        client.destroy();
      };

      return {
        client,
        deleteData: async () => {
          await client.delete();
          terminate();
        },
        destroy: () => {
          void client.close().finally(() => {
            terminate();
          });
        },
        id: runtimeId,
        terminateNow: terminate,
      };
    },
    getStats: () => ({ closeCount, createCount, initCount, terminateCount }),
    releaseClose: () => {
      databaseLocked = false;
      pendingClose?.resolve();
      pendingClose = null;
    },
  };
}

// An unreadable database whose wipe (deleteData) also fails — recovery must
// surface an error instead of hanging in a booting state.
export function createUnreadableUnwipeableSQLiteRuntimeFactory() {
  let createCount = 0;

  return {
    createSQLiteRuntime: (): SQLiteRuntime => {
      createCount += 1;
      const client: SQLiteRuntime["client"] = {
        close: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
        destroy() {},
        exec: async () => {
          throw new Error(
            "SQLITE_NOTADB: sqlite3 result code 26: file is not a database",
          );
        },
        init: async () => ({ ok: true }),
        ping: async () => ({ ok: true, message: "pong" }),
      };

      return {
        client,
        deleteData: async () => {
          throw new Error("planned wipe failure");
        },
        destroy: () => client.destroy(),
        id: `unwipeable-${createCount}`,
        terminateNow: () => client.destroy(),
      };
    },
    getStats: () => ({ createCount }),
  };
}

// First runtime simulates a persisted database encrypted under a now-lost key:
// init succeeds but the page-1 readability probe fails with SQLITE_NOTADB. The
// recovery should wipe it (deleteData) and the recreated runtime should boot.
export function createUnreadableThenHealedSQLiteRuntimeFactory() {
  let createCount = 0;
  let deleteDataCount = 0;

  return {
    createSQLiteRuntime: (): SQLiteRuntime => {
      createCount += 1;
      const unreadable = createCount === 1;
      const client: SQLiteRuntime["client"] = {
        close: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
        destroy() {},
        exec: async () => {
          if (unreadable) {
            throw new Error(
              "SQLITE_NOTADB: sqlite3 result code 26: file is not a database",
            );
          }

          return { ok: true, rows: [] };
        },
        init: async () => ({ ok: true }),
        ping: async () => ({ ok: true, message: "pong" }),
      };

      return {
        client,
        deleteData: async () => {
          deleteDataCount += 1;
          client.destroy();
        },
        destroy: () => client.destroy(),
        id: `heal-${createCount}`,
        terminateNow: () => client.destroy(),
      };
    },
    getStats: () => ({ createCount, deleteDataCount }),
  };
}
