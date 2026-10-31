import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  getPaneUserId,
  interact,
  listExplorerContainerItems,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  renderDualPane,
  selectContainerAndWaitForItemTable,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  clickExplorerRefresh,
  createChildContainer,
  createNoteWithAttachment,
  openExplorer,
  refreshUntil,
  selectPeerSharedContainer,
  waitForSharedNoteVisible,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import {
  clickShareWithPeer,
  shareContainerWithPeer,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  capturePostShareSyncBaseline,
  waitForNoPostShareSyncFailures,
} from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import { summarizeProxiedApiRequests } from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import {
  expectProxiedApiRequestBudget,
  type ProxiedApiRequestBudget,
  profileProxiedApiRequests,
} from "../../../../test/helpers/proxiedApiRequestBudget";
import { documentSyncIntentCounts } from "../../../../test/helpers/proxiedApiRequestMetrics";

const OWNER_GRANTED_ROOT_ATTACHMENT_REQUEST_BUDGET: ProxiedApiRequestBudget = {
  // Measure after provisioning/roster import, including background settlement.
  // Retain headroom for independently scheduled verification/recovery pulls.
  // See docs/request-budgets.md; DUAL_PANE_REQUEST_PROFILE=1 prints phase,
  // byte and sync-intent data.
  // Private metadata-root authority adds one directory discovery read per
  // operation; completed policy stages need no confirmation read. The
  // attachment's stage carries its part upload source and the bind completes
  // it. Batched discovery lists each reconciliation pass's lanes in one
  // request. The empty folder's create carries its metadata as its seed, so
  // no metadata sync follows. Measured 58 calls (62–68 before the seed) and
  // about 2.0–2.1 MB received; keep eight calls of scheduling room.
  total: 66,
  // Container mutations cite stored manifests by hash and principal policies
  // by head, so the share and its recitations echo neither path bundles nor
  // ~9.8 KB policies: 120 KB sent with create seeds (180 KB with policies,
  // 352 KB with bundles). Keep the same ~8% request headroom and room for two
  // extra document projections. Discovery reads naming a held directory head
  // receive that head alone (0.74 MB, 1.18 MB before). The peer's prefetch of
  // an unstored folder cites its listed parent's held bundles, and every
  // projection cites held KEK levels by digest: 0.59 MB received; keep about
  // 10% headroom.
  bodyBytes: { request: 130_000, response: 650_000 },
  byRequest: {
    "GET /principals/history": 0,
    "GET /documents/:documentId/writer-projection": 9,
    "POST /documents/:documentId/sync": 18,
    // Batched discovery: one listing per reconciliation pass (measured 2).
    "POST /containers/documents/query": 4,
    "GET /containers": 0,
    // Four held descendants re-cite the shared root and publish refresh hints.
    "POST /containers/parent-lanes/query": 11,
    "GET /auth/user-identity/:userId": 0,
    "POST /auth/ws-ticket": 0,
    // Includes classifying a newly visible root, fresh container info, and
    // the lazy projection read after acknowledging a successful share.
    // One more read authenticates the ordinary empty child's metadata binding
    // on the receiving device (#2365 finding #15).
    "GET /containers/:containerId/writer-projection": 7,
    "GET /documents/:documentId/attachments": 2,
    "GET /organizations/:organizationId/billing": 0,
    "GET /organizations/:organizationId/read-model": 6,
    "GET /principals/group/:groupId/policy": 0,
    // Measured 16–17, one per operation or pass.
    "GET /principals/organization/:organizationId/policy": 19,
    "GET /organizations/:organizationId/groups": 0,
    "POST /containers/with-metadata-document": 1,
    "POST /containers/:containerId/share": 1,
    "POST /containers/:containerId/recite": 4,
  },
};

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "an active roster peer can receive a direct container grant",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    await importPeerIntoRoster(leftPane, getPaneUserId(rightPane));

    await openExplorer(leftPane);
    await openExplorer(rightPane);

    await createChildContainer(leftPane, "Shared");
    await shareContainerWithPeer(leftPane, "Shared");
    await selectPeerSharedContainer(rightPane, "Shared");

    expect(listExplorerContainerItems(rightPane).length).toBeGreaterThan(1);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "an active roster peer sees the owner contact without the You label",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    const ownerUserId = getPaneUserId(leftPane);
    await importPeerIntoRoster(leftPane, getPaneUserId(rightPane));

    await openExplorer(leftPane);
    await openExplorer(rightPane);

    await refreshUntil(
      leftPane,
      () => getExplorerSidebarItemsByName(leftPane, "Contacts").length > 0,
      "Owner did not provision the Contacts system folder.",
    );
    const ownerContactsItemsTable = await selectContainerAndWaitForItemTable(
      leftPane,
      "Contacts",
    );
    await waitFor(() => {
      expect(
        within(ownerContactsItemsTable).queryByRole("button", {
          name: "You",
        }) ??
          within(ownerContactsItemsTable).queryByRole("button", {
            name: ownerUserId,
          }),
      ).toBeTruthy();
    });
    await act(async () => {
      await waitForAppTestRuntimeToSettle({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
      });
    });

    const postShareBaseline = capturePostShareSyncBaseline();
    await shareContainerWithPeer(leftPane, "Contacts");
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareBaseline,
    );

    await clickExplorerRefresh(rightPane);
    await refreshUntil(
      rightPane,
      () => getExplorerSidebarItemsByName(rightPane, "Contacts").length > 1,
      "Peer did not discover the shared Contacts container.",
    );

    const sharedContactsItem = getExplorerSidebarItemsByName(
      rightPane,
      "Contacts",
    ).at(-1);
    invariant(sharedContactsItem, "Expected a shared Contacts sidebar item.");
    await interact(() => {
      fireEvent.click(sharedContactsItem);
    });

    let sharedContactsItemsTable = await waitFor(() =>
      within(rightPane).getByRole("table", {
        name: "Items in Contacts",
      }),
    );
    await refreshUntil(
      rightPane,
      () => {
        sharedContactsItemsTable =
          within(rightPane).queryByRole("table", {
            name: "Items in Contacts",
          }) ?? sharedContactsItemsTable;
        return Boolean(
          within(sharedContactsItemsTable).queryByRole("button", {
            name: ownerUserId,
          }),
        );
      },
      "Peer did not discover the owner self contact in shared Contacts.",
    );

    expect(
      within(sharedContactsItemsTable).queryByRole("button", { name: "You" }),
    ).toBeNull();
    expect(
      within(sharedContactsItemsTable).getByRole("button", {
        name: ownerUserId,
      }),
    ).toBeTruthy();
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareBaseline,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "a duplicate direct grant to an active roster peer is a no-op",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    await importPeerIntoRoster(leftPane, getPaneUserId(rightPane));

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Shared");
    await shareContainerWithPeer(leftPane, "Shared");

    const duplicateShareBaseline = capturePostShareSyncBaseline();
    await clickShareWithPeer(leftPane);
    await waitForNoPostShareSyncFailures([leftPane], duplicateShareBaseline);

    const duplicateShareRequests = listProxiedApiRequests()
      .slice(duplicateShareBaseline.requestStartIndex)
      .filter(
        (request) =>
          request.method === "POST" && request.url.endsWith("/share"),
      );
    expect(
      duplicateShareRequests,
      `Duplicate peer share should not create another share mutation.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(duplicateShareBaseline.requestStartIndex))}`,
    ).toEqual([]);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "an active roster peer can receive a root grant after attachment writes",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    await importPeerIntoRoster(leftPane, getPaneUserId(rightPane));
    const testRequestStartIndex = listProxiedApiRequests().length;
    let requestPhaseStartIndex = testRequestStartIndex;

    await openExplorer(leftPane);
    profileProxiedApiRequests("open left explorer", requestPhaseStartIndex);
    requestPhaseStartIndex = listProxiedApiRequests().length;

    await openExplorer(rightPane);
    profileProxiedApiRequests("open right explorer", requestPhaseStartIndex);
    requestPhaseStartIndex = listProxiedApiRequests().length;

    await createChildContainer(leftPane, "Empty");
    profileProxiedApiRequests("create empty folder", requestPhaseStartIndex);
    requestPhaseStartIndex = listProxiedApiRequests().length;

    await createNoteWithAttachment(leftPane);
    profileProxiedApiRequests(
      "create note with attachment",
      requestPhaseStartIndex,
    );
    requestPhaseStartIndex = listProxiedApiRequests().length;

    const postShareBaseline = capturePostShareSyncBaseline();
    await shareContainerWithPeer(leftPane, "/");
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareBaseline,
    );
    profileProxiedApiRequests(
      "share root + post-share settle",
      requestPhaseStartIndex,
    );
    requestPhaseStartIndex = listProxiedApiRequests().length;

    const postDiscoveryBaseline = capturePostShareSyncBaseline();
    // The recipient pane re-lists its root containers automatically when the
    // share arrives (serverEventsBinding handles the "shared_with_you" event),
    // so the shared note surfaces without a manual refresh.
    await waitForSharedNoteVisible(rightPane);
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postDiscoveryBaseline,
    );
    profileProxiedApiRequests(
      "auto-discover shared note settle",
      requestPhaseStartIndex,
    );

    const shareRequest = listProxiedApiRequests()
      .filter(
        (request) =>
          request.method === "POST" && request.url.endsWith("/share"),
      )
      .at(-1);
    expect(shareRequest?.status).toBe(200);
    profileProxiedApiRequests("test total", testRequestStartIndex);
    const syncIntents = documentSyncIntentCounts(
      listProxiedApiRequests().slice(testRequestStartIndex),
    );
    // The empty folder's metadata rides its create as the create's seed; the
    // note attachment needs a write. If the eager note create finishes before
    // typing, the text needs its own sync; otherwise it is already in the
    // create payload. Both schedules are valid (delaying typing until after
    // creation reproduces the second write).
    expect(syncIntents.writeBearing).toBeGreaterThanOrEqual(1);
    expect(syncIntents.writeBearing).toBeLessThanOrEqual(2);
    expect(syncIntents.readOnly).toBeLessThanOrEqual(16);
    expectProxiedApiRequestBudget(
      "active-roster-user root attachment share",
      listProxiedApiRequests().slice(testRequestStartIndex),
      OWNER_GRANTED_ROOT_ATTACHMENT_REQUEST_BUDGET,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
