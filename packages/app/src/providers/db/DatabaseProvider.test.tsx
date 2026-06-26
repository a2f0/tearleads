import { afterEach, expect, test } from "bun:test";
import type { LocalKeyring } from "@tearleads/client-sdk";
import {
  PERSISTENT_STORAGE_POLICY,
  type SQLiteRuntime,
  type StoragePersistencePolicy,
} from "@tearleads/client-sdk/sqlite";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import {
  AppHostConfig,
  type CreateSQLiteRuntimeFn,
} from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { TearleadsProvider } from "../sdk/TearleadsProvider";
import { DatabaseProvider, useDatabase } from "./DatabaseProvider";

const TEST_SIGNING_FINGERPRINT =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

type DatabaseControls = ReturnType<typeof useDatabase>;
interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

afterEach(() => {
  cleanup();
});

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

class SilentWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super();
  }

  close() {}
}

function createRetryableSQLiteRuntimeFactory() {
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

function createRecordingSQLiteRuntimeFactory() {
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

function createRestartSensitiveSQLiteRuntimeFactory() {
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

function DatabaseProbe({
  onControls,
}: {
  onControls: (controls: DatabaseControls) => void;
}) {
  const controls = useDatabase();
  useEffect(() => {
    onControls(controls);
  }, [controls, onControls]);

  return <div>sqlite worker: {controls.status}</div>;
}

function renderDatabaseProvider(props: {
  readonly createLocalKeyring?: () => LocalKeyring;
  readonly createSQLiteRuntime: CreateSQLiteRuntimeFn;
  readonly storagePersistence?: StoragePersistencePolicy;
}) {
  const originalWebSocket = globalThis.WebSocket;
  const controlsReady = createDeferred();
  let controls: DatabaseControls | null = null;
  const getControls = () => {
    if (!controls) {
      throw new Error("Database controls were not rendered.");
    }

    return controls;
  };
  Reflect.set(globalThis, "WebSocket", SilentWebSocket);
  const view = render(
    <AppHostConfigProvider
      value={
        new AppHostConfig(
          "http://localhost:3001",
          "ws://localhost:3002",
          props.createSQLiteRuntime,
          undefined,
          undefined,
          props.createLocalKeyring,
          undefined,
          undefined,
          props.storagePersistence,
        )
      }
    >
      <LocalKeyringLockProvider>
        <LogProvider>
          <TearleadsProvider>
            <DatabaseProvider>
              <DatabaseProbe
                onControls={(nextControls) => {
                  controls = nextControls;
                  controlsReady.resolve();
                }}
              />
            </DatabaseProvider>
          </TearleadsProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>,
  );

  return {
    controlsReady,
    getControls,
    unmount: () => {
      view.unmount();
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    },
  };
}

test("ensureIdentityReady retries a failed identity database initialization", async () => {
  const runtimeFactory = createRetryableSQLiteRuntimeFactory();
  const originalConsoleError = console.error;
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    console.error = () => {};
    await view.controlsReady.promise;
    let firstError: unknown;
    await act(async () => {
      try {
        await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
      } catch (error: unknown) {
        firstError = error;
      }
    });
    expect(firstError).toBeInstanceOf(Error);
    expect(String(firstError)).toContain(
      "SQLite database failed to initialize.",
    );
    await waitFor(() => {
      expect(view.getControls().status).toBe("error");
    });

    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    expect(runtimeFactory.getStats()).toEqual({
      createCount: 2,
      destroyCount: 1,
      initCount: 2,
    });
  } finally {
    console.error = originalConsoleError;
    view.unmount();
  }
});

test("spawnWorker waits for a killed identity worker to release SQLite", async () => {
  const runtimeFactory = createRestartSensitiveSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    act(() => {
      view.getControls().killWorker();
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("terminated");
    });

    act(() => {
      view.getControls().spawnWorker();
    });
    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 1,
      initCount: 1,
      terminateCount: 0,
    });

    await act(async () => {
      runtimeFactory.releaseClose();
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 2,
      initCount: 2,
      terminateCount: 1,
    });
  } finally {
    await act(async () => {
      view.unmount();
    });
  }
});

test("pagehide terminates a killed worker while graceful release is pending", async () => {
  const runtimeFactory = createRestartSensitiveSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    act(() => {
      view.getControls().killWorker();
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("terminated");
    });
    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 1,
      initCount: 1,
      terminateCount: 0,
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 1,
      initCount: 1,
      terminateCount: 1,
    });

    await act(async () => {
      runtimeFactory.releaseClose();
      await Promise.resolve();
    });
  } finally {
    await act(async () => {
      view.unmount();
    });
  }
});

test("queued spawnWorker after kill is abandoned when provider unmounts", async () => {
  const runtimeFactory = createRestartSensitiveSQLiteRuntimeFactory();
  let unmounted = false;
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    act(() => {
      view.getControls().killWorker();
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("terminated");
    });
    act(() => {
      view.getControls().spawnWorker();
    });

    await act(async () => {
      view.unmount();
      unmounted = true;
      runtimeFactory.releaseClose();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 1,
      initCount: 1,
      terminateCount: 1,
    });
  } finally {
    if (!unmounted) {
      view.unmount();
    }
  }
});

test("the storage persistence policy and keyring cipher key thread into init", async () => {
  const runtimeFactory = createRecordingSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    storagePersistence: PERSISTENT_STORAGE_POLICY,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureReady();
    });

    await waitFor(() => {
      expect(runtimeFactory.getInitOptions().length).toBeGreaterThan(0);
    });
    for (const options of runtimeFactory.getInitOptions()) {
      expect(options.persistence).toBe(
        PERSISTENT_STORAGE_POLICY.databasePersistence,
      );
      // The cipher key must come from the keyring session, never a hardcoded
      // value, now that the database is persisted to disk.
      expect(options.key).toBe("test-sqlite-key");
      expect(options.key).not.toBe("development-key");
    }
  } finally {
    view.unmount();
  }
});
