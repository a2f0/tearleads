import { expect, mock, spyOn, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import type { DatabaseWorkerExecOptions } from "@tearleads/sqlite-worker/types";
import { createTestExecSql } from "@tearleads/test-utils";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createDeferred } from "../../../test/helpers/databaseRuntimeFactories";
import { createAppHostConfig } from "../../host/AppHostConfig";
import * as DatabaseProvider from "../db/DatabaseProvider";
import * as AppHostConfigProvider from "../host/AppHostConfigProvider";
import * as IdentityProvider from "../identity/IdentityProvider";
import * as LocalKeyringLockProvider from "../local-keyring/LocalKeyringLockProvider";
import * as LogProvider from "../logging/LogProvider";
import * as TearleadsProvider from "../sdk/TearleadsProvider";
import { CryptoSessionProvider } from "./CryptoSessionProvider";

async function createBootstrapFixture() {
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
  const logError = mock((_message: string | Error, _cause?: unknown) => {});
  const settled = createDeferred();
  const bootstrap = tearleads.session.bootstrapLocalRootContainer.bind(
    tearleads.session,
  );
  const spies = [
    spyOn(tearleads.session, "bootstrapLocalRootContainer").mockImplementation(
      async () => {
        try {
          return await bootstrap();
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
  const renderProvider = () => (
    <CryptoSessionProvider>
      <span>session</span>
    </CryptoSessionProvider>
  );
  const view = render(renderProvider());
  await act(async () => {
    await queryStarted.promise;
  });
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
      await fixture.database.execSql("DROP TABLE container_projection");
      fixture.releaseQuery();
      await fixture.settled.promise;
    });
    expect(fixture.logError).toHaveBeenCalledTimes(1);
    const [message, error] = fixture.logError.mock.calls[0] ?? [];
    expect(message).toBe("Failed to bootstrap root container");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(String((error as Error).cause)).toContain(
      "no such table: container_projection",
    );
  } finally {
    fixture.releaseQuery();
    fixture.close();
  }
});
