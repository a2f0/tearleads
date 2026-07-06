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
import {
  clickShareWithPeer,
  shareContainerWithPeer,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { waitForNoPostShareSyncFailures } from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
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
  // Observed ~111 (was ~100 before the org-public metadata container; earlier
  // ~120, see issue #1281 for the full profile). The ~11-request rise is the
  // per-org "Organization Metadata" container that every registration now mints
  // and read-grants to the Members group so any active roster member can
  // decrypt org-wide public fields: each pane's provisioning and the share
  // settle re-list, sync, and writer-project this extra container through the
  // same reconcile passes as the other system containers (roughly linear, one
  // more container = a bounded handful of requests, not a re-sync loop). The
  // earlier drop from ~120 came from making the test WebSocket harness mirror
  // production origin-based routing (the author no longer receives its own
  // echoes), suppressing self-echo in the container-metadata lane and on
  // server-side document-sync/attachment-bind broadcasts, and replacing global
  // writer-projection cache wipes with targeted eviction on retry. The bulk is
  // still read/reconcile convergence (poll + sync + writer-projection): only
  // ~12 requests actually mutate state. Driving this toward ~40 (#1281 phase A)
  // requires scoping the resync_required full-tree crawl and the reconciler
  // sweep force-pull, which are convergence-core and deferred (they risk
  // revocation/staleness bugs). Small headroom absorbs race timing; a real
  // re-sync loop would blow far past this.
  total: 116,
  byRequest: {
    // ~16-17 observed. Each container metadata document's writer projection is
    // primed from its create response (like plain document creates), so the
    // first read resolves locally instead of a cold GET; priming can only avoid
    // a fetch, so this stays a tight ceiling. The org metadata container adds
    // one more metadata document whose projection is read on reconcile.
    "GET /documents/:documentId/writer-projection": 18,
    // ~22 observed. A remote update arriving mid-pass is retained (per-document
    // signal sequencing) and re-synced rather than dropped, so each document
    // that sees a concurrent peer update during the share does its extra correct
    // passes. Self-echo suppression (metadata lane + server-side broadcast gated
    // on newly-inserted update ids) keeps a retry that re-acknowledges existing
    // updates from re-pinging. Per-doc counts stay small (<=5), confirming
    // convergence not amplification — a re-sync loop would blow far past this.
    "POST /documents/:documentId/sync": 26,
    // ~8-9 observed. Device-first reconciliation re-checks the active container
    // on open and refresh, forced server-event reconciliation rechecks each
    // event-scoped container once, and the system-container promotion pass lists
    // each promoted (Contacts/Trash) container's documents once. One quiet 404 +
    // retry can occur when bootstrap races a shared child before it is remotely
    // visible. Small headroom over the observed count.
    "GET /containers/:containerId/documents": 11,
    // The test WebSocket harness mirrors production routing: an access_changed
    // event evicts interested sockets, then each still-authorized pane rechecks
    // the tree before re-declaring interest. ~30 observed for ~4 root
    // containers/pane — every reconcile and server event re-lists the whole root
    // because events are hints, not deltas (#1281, phase A). The org metadata
    // container adds one more event-scoped reconcile per pane. Small headroom.
    "GET /containers": 32,
    // Device-first bootstrap can leave the explorer store on a pre-root runtime
    // briefly, so projection verification may resolve each pane's public user
    // key remotely once per workflow surface during the share handoff. Keep
    // this capped at two exact path hits per user to catch fetch loops.
    "GET /auth/encapsulation-key/:userId": 4,
    // One websocket auth ticket per pane (each opens one events socket). A tight
    // ceiling here catches a reconnect storm, since each reconnect re-mints one.
    "POST /auth/ws-ticket": 3,
    // Access rechecks can refetch the root writer projection once before the
    // socket re-declares interest.
    "GET /containers/:containerId/writer-projection": 5,
    // The owner and peer panes can each load attachment metadata once while
    // settling the shared root view; keep the ceiling tight to catch loops.
    "GET /documents/:documentId/attachments": 2,
    "GET /organizations/:organizationId/groups": 1,
    "POST /containers/with-metadata-document": 5,
  },
};

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "dual panes can share a container and refresh peer discovery",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

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
  "peer sees the owner self contact in a shared contacts folder without the You label",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    const ownerUserId = getPaneUserId(leftPane);

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

    const postShareRequestStartIndex = listProxiedApiRequests().length;
    await shareContainerWithPeer(leftPane, "Contacts");
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareRequestStartIndex,
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
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer treats a duplicate peer share as a no-op",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Shared");
    await shareContainerWithPeer(leftPane, "Shared");

    const duplicateShareRequestStartIndex = listProxiedApiRequests().length;
    await clickShareWithPeer(leftPane);
    await waitForNoPostShareSyncFailures(
      [leftPane],
      duplicateShareRequestStartIndex,
    );

    const duplicateShareRequests = listProxiedApiRequests()
      .slice(duplicateShareRequestStartIndex)
      .filter(
        (request) =>
          request.method === "POST" && request.url.endsWith("/share"),
      );
    expect(
      duplicateShareRequests,
      `Duplicate peer share should not create another share mutation.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(duplicateShareRequestStartIndex))}`,
    ).toEqual([]);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "dual panes can share an owner-granted root container after an empty folder and note attachment",
  async () => {
    useTestApiAppHandlers();
    const testRequestStartIndex = listProxiedApiRequests().length;
    let requestPhaseStartIndex = testRequestStartIndex;
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    profileProxiedApiRequests("provisioning", requestPhaseStartIndex);
    requestPhaseStartIndex = listProxiedApiRequests().length;

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

    const postShareRequestStartIndex = listProxiedApiRequests().length;
    await shareContainerWithPeer(leftPane, "/");
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareRequestStartIndex,
    );
    profileProxiedApiRequests(
      "share root + post-share settle",
      requestPhaseStartIndex,
    );
    requestPhaseStartIndex = listProxiedApiRequests().length;

    const postDiscoveryRequestStartIndex = listProxiedApiRequests().length;
    // The recipient pane re-lists its root containers automatically when the
    // share arrives (serverEventsBinding handles the "shared_with_you" event),
    // so the shared note surfaces without a manual refresh.
    await waitForSharedNoteVisible(rightPane);
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postDiscoveryRequestStartIndex,
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
      "owner-granted root attachment share",
      listProxiedApiRequests().slice(testRequestStartIndex),
      OWNER_GRANTED_ROOT_ATTACHMENT_REQUEST_BUDGET,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
