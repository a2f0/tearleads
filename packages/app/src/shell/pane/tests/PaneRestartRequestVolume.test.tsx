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
  editLifecycleNote,
  expectLifecycleReads,
  expectNoLateLifecycleRequests,
  renderLifecyclePane,
  seedLifecycleTree,
  unmountLifecyclePane,
  waitForLifecycleConnection,
  waitForLifecycleQuiet,
  waitForLifecycleTreeCrawl,
} from "../../../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  waitForPersistedPaneLocalIdentity,
} from "../../../../test/helpers/paneTestUtils";
import { createPersistedPaneStorage } from "../../../../test/helpers/persistedPaneStorage";
import type { ProxiedApiRequestBudget } from "../../../../test/helpers/proxiedApiRequestBudget";
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

/**
 * Restarts a pane holding two folders of `notesPerFolder` notes each and
 * measures the last restart. `settledRestarts` earlier restarts run first and
 * are left to settle unmeasured: the first restart after local writes lists
 * the rows those writes published, and the ones after it list nothing. With
 * `editedText`, the last unmeasured restart rewrites one note before it
 * closes, so the measured restart is the first one after that edit.
 */
async function measureRestart(input: {
  readonly budget: ProxiedApiRequestBudget;
  readonly editedText?: string;
  /** Folders of one note each, beyond the fixture's two. */
  readonly extraFolders?: number;
  readonly label: string;
  readonly notesPerFolder: number;
  readonly settledRestarts?: number;
}) {
  useTestApiAppHandlers();
  const storage = createPersistedPaneStorage();
  const namespace = `restart-budget-${crypto.randomUUID()}`;
  const hostConfig = createTestHostConfig({
    autoProvisionIdentity: true,
    localIdentityNamespace: namespace,
  }).withOverrides({ createSQLiteRuntime: storage.createRuntime });
  const first = renderLifecyclePane(hostConfig);
  await seedLifecycleTree(first.pane, input.notesPerFolder, input.extraFolders);
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
  const expectWorkersClosed = async (count: number) => {
    await waitFor(() => expect(storage.closedWorkers.size).toBe(count));
    expect(storage.workers.every((worker) => worker.terminated)).toBe(true);
  };
  await expectWorkersClosed(1);

  const settledRestarts = input.settledRestarts ?? 0;
  for (let restart = 1; restart <= settledRestarts; restart += 1) {
    const settled = renderLifecyclePane(hostConfig);
    await waitForSinglePaneProvisioning(settled.pane);
    await waitForLifecycleConnection(settled.sdk(), 1);
    await openExplorer(settled.pane);
    await waitForLifecycleQuiet();
    if (restart === settledRestarts && input.editedText !== undefined) {
      await editLifecycleNote(settled.pane, settled.sdk(), input.editedText);
      await waitForLifecycleQuiet();
    }
    await unmountLifecyclePane(settled);
    await expectWorkersClosed(1 + restart);
  }

  let restarted: ReturnType<typeof renderLifecyclePane> | undefined;
  const requests = await measureWorkflowRequests({
    label: input.label,
    budget: input.budget,
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
      await waitForLifecycleTreeCrawl(second.sdk());
      // Every row these lanes listed is this device's own write, which its
      // cursor already counts and whose access head its record names.
      expect(
        await second
          .sdk()
          .runtime.input()
          .infra.execSql(
            "SELECT document_id FROM document_listing_revalidations",
          ),
      ).toEqual([]);
    },
  });
  expectLifecycleReads(requests);
  await expectNoLateLifecycleRequests();
  expect(storage.initializedDatabaseNames).toHaveLength(2 + settledRestarts);
  expect(new Set(storage.initializedDatabaseNames).size).toBe(1);
  invariant(restarted, "Expected restarted pane");
  await unmountLifecyclePane(restarted);
  await expectWorkersClosed(2 + settledRestarts);
  await expectNoLateLifecycleRequests();
  return requests;
}

test("a pane restart reconciles its persisted tree without replaying writes", async () => {
  // The first restart after the notes were created: their lanes list the
  // rows those creates published, and each listed row's head is verified
  // with one document writer-projection read. No note is synced: the cursor
  // each create left covers the count its row lists.
  await measureRestart({
    budget: {
      total: 19,
      byRequest: {
        "POST /auth/ws-ticket": 1,
        "GET /organization-memberships": 1,
        "GET /organizations/:organizationId/billing": 1,
        "POST /containers/parent-lanes/query": 1,
        "POST /containers/documents/query": 3,
        "GET /principals/organization/:organizationId/policy": 2,
        "GET /principals/group/:groupId/policy": 0,
        "GET /principals/history": 1,
        "GET /containers/:containerId/writer-projection": 3,
        "GET /documents/:documentId/writer-projection": 3,
        "POST /documents/:documentId/sync": 3,
      },
    },
    label: "persisted pane restart",
    notesPerFolder: 1,
  });
}, 60_000);

// A restart whose lanes already listed this device's own writes, which is
// every restart after the first. The server holds nothing the device lacks,
// so the tree crawl is served no folder's row and the catch-up after the
// acknowledgement lists no document lane: no note is synced or has its head
// read, and the cost is the same with two notes and with eight. The syncs
// left are system-container documents. The two listings are one batch of
// queued lanes and one unwatermarked batch for the initial probe. The tree
// crawl is one request: it lists up to 32 parent lanes at once.
const SETTLED_RESTART_BUDGET: ProxiedApiRequestBudget = {
  total: 11,
  byRequest: {
    "POST /auth/ws-ticket": 1,
    "GET /organization-memberships": 1,
    "GET /organizations/:organizationId/billing": 1,
    "POST /containers/parent-lanes/query": 1,
    "POST /containers/documents/query": 2,
    "GET /principals/organization/:organizationId/policy": 1,
    "GET /principals/group/:groupId/policy": 0,
    "GET /principals/history": 0,
    "GET /containers/:containerId/writer-projection": 2,
    "GET /documents/:documentId/writer-projection": 0,
    "POST /documents/:documentId/sync": 2,
  },
};

test("a settled restart costs the same whatever the number of notes", async () => {
  for (const notesPerFolder of [1, 4]) {
    await measureRestart({
      budget: SETTLED_RESTART_BUDGET,
      label: `settled restart with ${notesPerFolder * 2} notes`,
      notesPerFolder,
      settledRestarts: 1,
    });
    await cleanupPaneTestEnvironment();
  }
}, 180_000);

test("a settled restart costs the same with two folders and with eight", async () => {
  // Six more folders cost no more requests: the initial probe reads every
  // lane's unwatermarked listing in one batch, the tree crawl lists every
  // parent lane in one request, and no folder's row moved, so the catch-up
  // lists no document lane.
  await measureRestart({
    budget: SETTLED_RESTART_BUDGET,
    extraFolders: 6,
    label: "settled restart with 8 folders",
    notesPerFolder: 1,
    settledRestarts: 1,
  });
}, 180_000);

test("the first restart after a local edit owes that note no read", async () => {
  // The edit republished the note's folder, so the tree crawl is served that
  // folder's row and the catch-up lists its document lane: one more listing
  // and one more policy read than a settled restart. The device's own
  // accepted update is behind its cursor, so the listing owes no read: the
  // syncs are the same system-container documents, and the note is neither
  // synced nor has its head read.
  await measureRestart({
    budget: {
      total: 13,
      byRequest: {
        ...SETTLED_RESTART_BUDGET.byRequest,
        "POST /containers/documents/query": 3,
        "GET /principals/organization/:organizationId/policy": 2,
      },
    },
    editedText: "Rewritten on this device",
    label: "restart after a local edit",
    notesPerFolder: 1,
    settledRestarts: 1,
  });
}, 120_000);
