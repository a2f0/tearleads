import { afterEach, expect, spyOn, test } from "bun:test";
import { createSQLiteRuntimeFromWorker } from "@tearleads/client-sdk/sqlite";
import { waitFor } from "@testing-library/react";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { MockWorker } from "../../../../test/helpers/mockWorker";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  expectLifecycleRequestBoundary,
  PANE_RESTART_BUDGET,
} from "../../../../test/helpers/paneLifecycleRequestBudgets";
import {
  expectCachedLifecycleNotes,
  expectNoPendingPaneWrites,
  provisionLifecyclePane,
  renderLifecyclePane,
  waitForLifecycleConnection,
} from "../../../../test/helpers/paneLifecycleRequestFixture";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  waitForPersistedPaneLocalIdentity,
} from "../../../../test/helpers/paneTestUtils";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

// MockWorker owns the wasm-VFS filename map. Retain only that worker, not the
// SDK or its SQLite client: ordinary runtime teardown closes the connection,
// then a fresh runtime reopens the same named database on the next mount.
class RestartStorageWorker extends MockWorker {
  releasedRuntimeCount = 0;
  override terminate() {
    this.releasedRuntimeCount += 1;
  }
  disposeStorage() {
    super.terminate();
  }
}

let storage: RestartStorageWorker | null = null;
afterEach(async () => {
  await cleanupPaneTestEnvironment();
  storage?.disposeStorage();
  storage = null;
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test("pane restart on the same local database has a complete request budget", async () => {
  useTestApiAppHandlers();
  storage = new RestartStorageWorker();
  const worker = storage;
  const namespace = `request-restart-${crypto.randomUUID()}`;
  const host = createTestHostConfig({
    localIdentityNamespace: namespace,
  }).withOverrides({
    createSQLiteRuntime: () => createSQLiteRuntimeFromWorker(worker),
  });
  const first = renderLifecyclePane(host);
  await provisionLifecyclePane(first);
  await waitForPersistedPaneLocalIdentity(namespace);
  const oldSdk = first.sdk;
  const oldDb = oldSdk.database.id;
  const marker = crypto.randomUUID();
  await oldSdk.database.requireExecSql()(
    "CREATE TABLE restart_canary (marker TEXT NOT NULL)",
  );
  await oldSdk.database.requireExecSql()(
    "INSERT INTO restart_canary VALUES (?)",
    [marker],
  );
  const oldSession = oldSdk.session.authToken;
  const oldTree = oldSdk.deviceFirst.open().containerStore;
  const containerIds = oldTree
    .getSnapshot()
    .nodes.map((node) => node.id)
    .sort();
  const disposed = spyOn(oldSdk, "dispose");
  const beforeClose = worker.releasedRuntimeCount;

  try {
    const requests = await measureWorkflowRequests({
      label: "pane restart unchanged server",
      mutations: [],
      budget: PANE_RESTART_BUDGET,
      operation: async () => {
        first.view.unmount();
        await waitFor(() => {
          expect(disposed).toHaveBeenCalledTimes(1);
          expect(worker.releasedRuntimeCount).toBeGreaterThan(beforeClose);
        });
        const restarted = renderLifecyclePane(host);
        await waitForLifecycleConnection(restarted.sdk);
        expect(restarted.sdk).not.toBe(oldSdk);
        expect(restarted.sdk.database.id).not.toBe(oldDb);
        expect(
          await restarted.sdk.database.requireExecSql()(
            "SELECT marker FROM restart_canary",
          ),
        ).toEqual([{ marker }]);
        expect(restarted.sdk.session.authToken).toBe(oldSession);
        expect(restarted.sdk.deviceFirst.open().containerStore).not.toBe(
          oldTree,
        );
        await openExplorer(restarted.pane);
        await expectCachedLifecycleNotes(restarted.sdk);
        expect(
          restarted.sdk.deviceFirst
            .open()
            .containerStore.getSnapshot()
            .nodes.map((node) => node.id)
            .sort(),
        ).toEqual(containerIds);
        await expectNoPendingPaneWrites(restarted.sdk);
      },
    });
    expectLifecycleRequestBoundary(requests, PANE_RESTART_BUDGET);
  } finally {
    disposed.mockRestore();
  }
}, 60_000);
