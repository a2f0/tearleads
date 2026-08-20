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

const OWNER_GRANTED_ROOT_ATTACHMENT_REQUEST_BUDGET: ProxiedApiRequestBudget = {
  // Startup recovery deliberately adds two read-only document probes; one may
  // also warm a writer projection. Initial hydration now authoritatively lists
  // remotely listable lanes across both panes and forces normal sync for local
  // documents absent from those listings, including primary projections that
  // have not acquired a discovery-link row yet. Repair profiles measured 102
  // total requests, at most 27 container-document listings, and 28 document
  // syncs. Keep narrow headroom and the deleted singular endpoint pinned to
  // zero.
  total: 105,
  byRequest: {
    "GET /documents/:documentId/writer-projection": 11,
    "POST /documents/:documentId/sync": 30,
    "GET /containers/:containerId/documents": 27,
    "GET /containers": 0,
    "POST /containers/parent-lanes/query": 9,
    "GET /auth/user-identity/:userId": 2,
    "POST /auth/ws-ticket": 2,
    "GET /containers/:containerId/writer-projection": 3,
    "GET /documents/:documentId/attachments": 2,
    "GET /organizations/:organizationId/billing": 2,
    "GET /organizations/:organizationId/read-model": 2,
    "GET /principals/group/:groupId/policy": 2,
    "GET /organizations/:organizationId/groups": 0,
    "POST /containers/with-metadata-document": 3,
    "POST /containers/:containerId/share": 1,
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
    expectProxiedApiRequestBudget(
      "active-roster-user root attachment share",
      listProxiedApiRequests().slice(testRequestStartIndex),
      OWNER_GRANTED_ROOT_ATTACHMENT_REQUEST_BUDGET,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
