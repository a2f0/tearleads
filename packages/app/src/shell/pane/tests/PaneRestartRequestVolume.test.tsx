import { afterEach, expect, spyOn, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import invariant from "invariant";
import {
  getExplorerSidebarItem,
  getPaneUserId,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  expectLifecycleReads,
  expectNoLateLifecycleRequests,
  renderLifecyclePane,
  seedLifecycleTree,
  unmountLifecyclePane,
  waitForLifecycleConnection,
} from "../../../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  waitForPersistedPaneLocalIdentity,
} from "../../../../test/helpers/paneTestUtils";
import { createPersistedPaneStorage } from "../../../../test/helpers/persistedPaneStorage";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test("restart storage survives a closed and terminated worker", async () => {
  const storage = createPersistedPaneStorage();
  const options = {
    dbName: "restart-canary",
    cipher: "chacha20",
    key: "test",
  } as const;
  const first = storage.createRuntime();
  await first.client.init(options);
  await first.client.exec({ sql: "CREATE TABLE restart_canary (value TEXT)" });
  await first.client.exec({
    sql: "INSERT INTO restart_canary VALUES ('persisted')",
  });
  await first.client.close();
  first.terminateNow();
  const second = storage.createRuntime();
  try {
    await second.client.init(options);
    const tables = await second.client.exec({
      sql: "SELECT name FROM sqlite_master WHERE name = 'restart_canary'",
    });
    expect(tables.rows).toEqual([{ name: "restart_canary" }]);
    expect(
      (await second.client.exec({ sql: "SELECT value FROM restart_canary" }))
        .rows,
    ).toEqual([{ value: "persisted" }]);
  } finally {
    await second.client.close();
    second.terminateNow();
  }
});

test("a pane restart reconciles its persisted tree without replaying writes", async () => {
  useTestApiAppHandlers();
  const storage = createPersistedPaneStorage();
  const namespace = `restart-budget-${crypto.randomUUID()}`;
  const hostConfig = createTestHostConfig({
    autoProvisionIdentity: true,
    localIdentityNamespace: namespace,
  }).withOverrides({ createSQLiteRuntime: storage.createRuntime });
  const first = renderLifecyclePane(hostConfig);
  await seedLifecycleTree(first.pane);
  await waitForLifecycleConnection(first.sdk(), 1);
  await waitForPersistedPaneLocalIdentity(namespace);
  const userId = getPaneUserId(first.pane);
  const firstSdk = first.sdk();
  const firstTree = firstSdk.deviceFirst.open().containerStore;
  expect(
    await firstSdk.containerContents.documentQueries().listPendingWrites(),
  ).toEqual([]);
  // A local-only sentinel cannot be recreated by the test API. Its survival
  // distinguishes reopening SQLite from recovering a new DB from the server.
  await firstSdk.runtime
    .input()
    .infra.execSql("CREATE TABLE restart_canary (value TEXT)");
  await firstSdk.runtime
    .input()
    .infra.execSql("INSERT INTO restart_canary VALUES (?)", [userId]);
  const dispose = spyOn(firstSdk, "dispose");
  await unmountLifecyclePane(first);
  expect(dispose).toHaveBeenCalledTimes(1);
  dispose.mockRestore();
  await waitFor(() =>
    expect(storage.workers.every((worker) => worker.terminated)).toBe(true),
  );
  expect(storage.closedWorkers.size).toBe(1);

  let restarted: ReturnType<typeof renderLifecyclePane> | undefined;
  const requests = await measureWorkflowRequests({
    label: "persisted pane restart",
    budget: {
      total: 23,
      byRequest: {
        "POST /auth/ws-ticket": 1,
        "GET /organization-memberships": 1,
        "GET /organizations/:organizationId/billing": 1,
        "POST /containers/parent-lanes/query": 2,
        "POST /containers/documents/query": 3,
        "GET /principals/organization/:organizationId/policy": 2,
        "GET /principals/group/:groupId/policy": 0,
        "GET /principals/history": 1,
        "GET /containers/:containerId/writer-projection": 3,
        "GET /documents/:documentId/writer-projection": 3,
        "POST /documents/:documentId/sync": 6,
      },
    },
    mutations: [],
    operation: async () => {
      const second = renderLifecyclePane(hostConfig);
      restarted = second;
      await waitForSinglePaneProvisioning(second.pane);
      await waitForLifecycleConnection(second.sdk(), 1);
      expect(second.sdk()).not.toBe(firstSdk);
      expect(second.sdk().deviceFirst.open().containerStore).not.toBe(
        firstTree,
      );
      expect(getPaneUserId(second.pane)).toBe(userId);
      expect(
        await second
          .sdk()
          .runtime.input()
          .infra.execSql("SELECT value FROM restart_canary"),
      ).toEqual([{ value: userId }]);
      await openExplorer(second.pane);
      for (const name of ["Canary A", "Canary B"]) {
        expect(getExplorerSidebarItem(second.pane, name)).toBeTruthy();
      }
      expect(
        await second
          .sdk()
          .containerContents.documentQueries()
          .listPendingWrites(),
      ).toEqual([]);
    },
  });
  expectLifecycleReads(requests);
  await expectNoLateLifecycleRequests();
  expect(storage.initializedDatabaseNames).toHaveLength(2);
  expect(new Set(storage.initializedDatabaseNames).size).toBe(1);
  invariant(restarted, "Expected restarted pane");
  await unmountLifecyclePane(restarted);
  await waitFor(() => expect(storage.closedWorkers.size).toBe(2));
  expect(storage.workers.every((worker) => worker.terminated)).toBe(true);
  await expectNoLateLifecycleRequests();
}, 60_000);
