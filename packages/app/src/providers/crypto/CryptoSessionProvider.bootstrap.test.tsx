import { expect, mock, spyOn, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { DATABASE_BUSY_RUN_LIMIT } from "@tearleads/client-sdk/sqlite";
import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import {
  DATABASE_TRANSACTION_BUSY_MESSAGE,
  type DatabaseWorkerExecOptions,
} from "@tearleads/sqlite-worker/types";
import { createTestExecSql } from "@tearleads/test-utils";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { createDeferred } from "../../../test/helpers/databaseRuntimeFactories";
import { createAppHostConfig } from "../../host/AppHostConfig";
import * as DatabaseProvider from "../db/DatabaseProvider";
import * as AppHostConfigProvider from "../host/AppHostConfigProvider";
import * as IdentityProvider from "../identity/IdentityProvider";
import * as LocalKeyringLockProvider from "../local-keyring/LocalKeyringLockProvider";
import * as LogProvider from "../logging/LogProvider";
import * as TearleadsProvider from "../sdk/TearleadsProvider";
import { CryptoSessionProvider } from "./CryptoSessionProvider";

interface BootstrapFixtureOptions {
  readonly authenticated?: boolean;
  /** Busy refusals the root bootstrap meets before it runs. */
  readonly busyRefusals?: number;
  /** Whether setup waits for the bootstrap's container query. */
  readonly awaitQuery?: boolean;
  readonly onBootstrap?: (
    attempt: number,
    isCurrent: (() => boolean) | undefined,
    runDefault: () => ReturnType<
      Tearleads["session"]["bootstrapLocalRootContainer"]
    >,
  ) => ReturnType<Tearleads["session"]["bootstrapLocalRootContainer"]>;
  readonly strictMode?: boolean;
}

async function createBootstrapFixture({
  authenticated = false,
  busyRefusals: refusals = 0,
  awaitQuery = true,
  onBootstrap,
  strictMode = false,
}: BootstrapFixtureOptions = {}) {
  let busyRefusals = refusals;
  const database = await createTestExecSql("root-bootstrap-cancellation");
  const queryStarted = createDeferred();
  const queryReleased = createDeferred();
  let holdQuery = true;
  class Worker extends EventTarget {
    postMessage(message: { id: number; params: DatabaseWorkerExecOptions }) {
      const { id, params } = message;
      void (async () => {
        if (holdQuery && params.sql.includes('from "containers"')) {
          queryStarted.resolve();
          await queryReleased.promise;
        }
        try {
          const rows = await database.execSql(params.sql, params.bind, {
            rowMode: params.rowMode ?? "object",
          });
          this.dispatchEvent(
            new MessageEvent("message", {
              data: { id, result: { ok: true, rows } },
            }),
          );
        } catch (error) {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: { id, result: { ok: false, message: String(error) } },
            }),
          );
        }
      })();
    }
  }
  const worker = new Worker();
  const client = createDatabaseWorkerClient(worker);
  const tearleads = new Tearleads({
    blobStore: createMemoryBlobStore(),
    database: { client },
    identityProvisioning: "manual",
  });
  if (authenticated)
    tearleads.session.setContext({ authToken: "same", isAuthenticated: true });
  const logError = mock((_message: string | Error, _cause?: unknown) => {});
  const settled = createDeferred();
  const bootstrap = tearleads.session.bootstrapLocalRootContainer.bind(
    tearleads.session,
  );
  let bootstrapAttempt = 0;
  const spies = [
    spyOn(tearleads.session, "bootstrapLocalRootContainer").mockImplementation(
      async (isCurrent) => {
        bootstrapAttempt += 1;
        if (onBootstrap) {
          return await onBootstrap(bootstrapAttempt, isCurrent, () =>
            bootstrap(isCurrent),
          );
        }
        if (busyRefusals > 0) {
          busyRefusals -= 1;
          throw new Error(DATABASE_TRANSACTION_BUSY_MESSAGE);
        }
        try {
          return await bootstrap(isCurrent);
        } finally {
          settled.resolve();
        }
      },
    ),
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue(tearleads),
    spyOn(LogProvider, "useLog").mockReturnValue({ log: () => {}, logError }),
    spyOn(AppHostConfigProvider, "useAppHostConfig").mockReturnValue(
      createAppHostConfig({
        apiBaseUrl: "http://localhost:3001",
        wsUrl: "ws://localhost:3002",
      }),
    ),
    spyOn(DatabaseProvider, "useDatabase").mockImplementation(() => ({
      ...tearleads.database.snapshot,
      clearWorker: () => {},
      clearWorkerForIdentitySwitch: () => {},
      ensureIdentityReady: async () => {},
      ensureReady: async () => {},
      killWorker: () => {},
      purgeWorker: async () => {},
      purgeIdentityDatabase: async () => {},
      spawnWorker: () => {},
    })),
    spyOn(IdentityProvider, "useIdentity").mockReturnValue({
      signingFingerprint: "test-fingerprint",
      signingKeyPair: {},
    } as ReturnType<typeof IdentityProvider.useIdentity>),
    spyOn(LocalKeyringLockProvider, "useLocalKeyringLock").mockReturnValue({
      createLocalKeyring: undefined,
      isLocked: true,
    } as ReturnType<typeof LocalKeyringLockProvider.useLocalKeyringLock>),
  ];
  const renderProvider = () => {
    const provider = (
      <CryptoSessionProvider>
        <span>session</span>
      </CryptoSessionProvider>
    );
    return strictMode ? <StrictMode>{provider}</StrictMode> : provider;
  };
  const view = render(renderProvider());
  if (awaitQuery) {
    await act(async () => {
      await queryStarted.promise;
    });
  }
  return {
    client,
    database,
    logError,
    settled,
    tearleads,
    releaseQuery() {
      holdQuery = false;
      queryReleased.resolve();
    },
    rerender() {
      view.rerender(renderProvider());
    },
    bootstrapCalls: () => spies[0]?.mock.calls.length ?? 0,
    unmount() {
      view.unmount();
    },
    close() {
      cleanup();
      client.destroy();
      tearleads.dispose();
      database.close();
      for (const spy of spies) spy.mockRestore();
    },
  };
}

test("root bootstrap treats a destroyed worker as cancellation and retries on its replacement", async () => {
  const fixture = await createBootstrapFixture();
  try {
    await act(async () => {
      fixture.client.destroy();
      await fixture.settled.promise;
    });
    expect(fixture.logError).not.toHaveBeenCalled();
    expect(fixture.tearleads.session.containerId).toBeNull();
    await act(async () => {
      fixture.releaseQuery();
      fixture.tearleads.database.setClient({
        async exec({ sql, bind, rowMode }) {
          return {
            rows: await fixture.database.execSql(sql, bind, {
              rowMode: rowMode ?? "object",
            }),
          };
        },
      });
      fixture.rerender();
    });
    await waitFor(() =>
      expect(fixture.tearleads.session.containerId).not.toBeNull(),
    );
    expect(fixture.logError).not.toHaveBeenCalled();
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});

test("root bootstrap still reports a genuine SQLite query failure", async () => {
  const fixture = await createBootstrapFixture();
  try {
    await act(async () => {
      await fixture.database.execSql("DROP TABLE containers");
      fixture.releaseQuery();
      await fixture.settled.promise;
    });
    expect(fixture.logError).toHaveBeenCalledTimes(1);
    const [message, error] = fixture.logError.mock.calls[0] ?? [];
    expect(message).toBe("Failed to bootstrap root container");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(String((error as Error).cause)).toContain(
      "no such table: containers",
    );
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});

test("a replacement sign-in can bootstrap its local root while the previous lookup settles", async () => {
  const fixture = await createBootstrapFixture({ authenticated: true });
  try {
    await act(async () => {
      fixture.tearleads.session.setContext({
        authToken: "same",
        isAuthenticated: true,
      });
      fixture.rerender();
      fixture.releaseQuery();
      await fixture.settled.promise;
    });
    await waitFor(
      () => expect(fixture.tearleads.session.containerId).not.toBeNull(),
      { timeout: 1000 },
    );
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});

// #3360: nothing the bootstrap effect depends on changes when another tab's
// transaction ends, so a refusal that outlasted the retry bound used to leave
// the root container unbootstrapped until an unrelated change.
test("a root bootstrap refused as busy runs again without a status change", async () => {
  const fixture = await createBootstrapFixture({
    busyRefusals: DATABASE_BUSY_RUN_LIMIT,
  });
  try {
    await act(async () => {
      fixture.releaseQuery();
      await fixture.settled.promise;
    });
    await waitFor(() =>
      expect(fixture.tearleads.session.containerId).not.toBeNull(),
    );
    expect(fixture.logError).not.toHaveBeenCalled();
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});

test("an unmounted provider stops retrying a busy root bootstrap", async () => {
  const fixture = await createBootstrapFixture({
    awaitQuery: false,
    busyRefusals: Number.POSITIVE_INFINITY,
  });
  try {
    await waitFor(() =>
      expect(fixture.bootstrapCalls()).toBe(DATABASE_BUSY_RUN_LIMIT),
    );
    fixture.unmount();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1_500)));
    expect(fixture.bootstrapCalls()).toBe(DATABASE_BUSY_RUN_LIMIT);
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});

test("a StrictMode remount keeps the running root bootstrap instead of starting another", async () => {
  const fixture = await createBootstrapFixture({ strictMode: true });
  try {
    await act(async () => {
      fixture.releaseQuery();
      await fixture.settled.promise;
    });
    await waitFor(() =>
      expect(fixture.tearleads.session.containerId).not.toBeNull(),
    );
    expect(fixture.bootstrapCalls()).toBe(1);
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});

test("a busy root bootstrap stops once a root container exists", async () => {
  const fixture = await createBootstrapFixture({
    awaitQuery: false,
    busyRefusals: Number.POSITIVE_INFINITY,
  });
  try {
    await waitFor(() => expect(fixture.bootstrapCalls()).toBeGreaterThan(0));
    act(() => fixture.tearleads.session.setContainerId("root-from-elsewhere"));
    const callsWhenKnown = fixture.bootstrapCalls();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1_500)));
    expect(fixture.bootstrapCalls()).toBe(callsWhenKnown);
    expect(fixture.tearleads.session.containerId).toBe("root-from-elsewhere");
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});

test("a run stopped by a brief lapse restarts when wanted again instead of failing idle", async () => {
  const firstStarted = createDeferred();
  const checkDuringLapse = createDeferred();
  const rejectAfterWanted = createDeferred();
  const fixture = await createBootstrapFixture({
    awaitQuery: false,
    onBootstrap: async (attempt, isCurrent, runDefault) => {
      if (attempt === 1) {
        firstStarted.resolve();
        await checkDuringLapse.promise;
        const stillCurrent = isCurrent?.();
        await rejectAfterWanted.promise;
        if (!stillCurrent) {
          throw new Error("superseded during lapse");
        }
      }
      return runDefault();
    },
  });
  try {
    await firstStarted.promise;
    // Brief lapse: root container appears, run observes !isCurrent(), then
    // root container clears again before the first run rejects.
    act(() => fixture.tearleads.session.setContainerId("temporary"));
    checkDuringLapse.resolve();
    await Promise.resolve();
    act(() => fixture.tearleads.session.setContainerId(null));
    fixture.releaseQuery();
    await act(async () => {
      rejectAfterWanted.resolve();
    });
    await waitFor(() =>
      expect(fixture.tearleads.session.containerId).not.toBeNull(),
    );
    expect(fixture.bootstrapCalls()).toBe(2);
    expect(fixture.logError).not.toHaveBeenCalled();
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});
