import { afterEach, expect, test } from "bun:test";
import type { SQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
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

afterEach(() => {
  cleanup();
});

function createDeferred<T = void>() {
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
        destroy: () => client.destroy(),
        id: runtimeId,
      };
    },
    getStats: () => ({ createCount, destroyCount, initCount }),
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
  readonly createSQLiteRuntime: CreateSQLiteRuntimeFn;
  readonly onControls: (controls: DatabaseControls) => void;
}) {
  const originalWebSocket = globalThis.WebSocket;
  Reflect.set(globalThis, "WebSocket", SilentWebSocket);
  const view = render(
    <AppHostConfigProvider
      value={
        new AppHostConfig(
          "http://localhost:3001",
          "ws://localhost:3002",
          props.createSQLiteRuntime,
        )
      }
    >
      <LocalKeyringLockProvider>
        <LogProvider>
          <TearleadsProvider>
            <DatabaseProvider>
              <DatabaseProbe onControls={props.onControls} />
            </DatabaseProvider>
          </TearleadsProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>,
  );

  return {
    unmount: () => {
      view.unmount();
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    },
  };
}

test("ensureIdentityReady retries a failed identity database initialization", async () => {
  const runtimeFactory = createRetryableSQLiteRuntimeFactory();
  const controlsReady = createDeferred();
  let controls: DatabaseControls | null = null;
  const getControls = () => {
    if (!controls) {
      throw new Error("Database controls were not rendered.");
    }

    return controls;
  };
  const originalConsoleError = console.error;
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    onControls: (nextControls) => {
      controls = nextControls;
      controlsReady.resolve();
    },
  });

  try {
    console.error = () => {};
    await controlsReady.promise;
    let firstError: unknown;
    await act(async () => {
      try {
        await getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
      } catch (error: unknown) {
        firstError = error;
      }
    });
    expect(firstError).toBeInstanceOf(Error);
    expect(String(firstError)).toContain(
      "SQLite database failed to initialize.",
    );
    await waitFor(() => {
      expect(getControls().status).toBe("error");
    });

    await act(async () => {
      await getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(getControls().status).toBe("ready");
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
