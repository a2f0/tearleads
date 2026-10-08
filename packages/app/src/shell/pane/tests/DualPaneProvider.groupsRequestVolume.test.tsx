import { afterEach, expect, test } from "bun:test";
import type { ContainerContentsStore } from "@tearleads/client-sdk";
import { isDocumentSyncStateStaleErrorResponse } from "@tearleads/validators/response";
import { act, cleanup } from "@testing-library/react";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import { ContainerTreeProbe } from "../../../../test/helpers/dual-pane/ContainerTreeProbe";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  getPaneUserId,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { addPeerToAdminsGroup } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  capturePostShareSyncBaseline,
  waitForNoPostShareSyncFailures,
} from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
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
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import type { PaneSide } from "../dual-pane";

// Separate navigation from mutation so UI reads cannot conceal sync churn.
// The deferred author-echo release still reads the feed: a sibling client can
// share this login session, so session origin alone cannot prove an own echo.
// Keep that correctness read; #1512's speculative protocol work is retired.
const ADMIN_GROUP_OPEN_REQUEST_BUDGET: ProxiedApiRequestBudget = {
  // Cold bounded recovery discovers/verifies the directory and Admins head.
  total: 3,
  byRequest: {
    "GET /organizations/:organizationId/read-model": 1,
    "GET /organizations/:organizationId/groups/:groupId/containers": 0,
    "GET /organizations/:organizationId/groups/:groupId/members": 0,
    "GET /principals/group/:groupId/policy": 1,
    "GET /organizations/:organizationId/directory": 0,
    "GET /organizations/:organizationId/data-usage": 0,
    "GET /organizations/:organizationId/grants": 0,
    "GET /organizations/:organizationId/groups": 0,
    "GET /principals/organization/:organizationId/policy": 1,
    "POST /containers/:containerId/share": 0,
    "PUT /organizations/:organizationId/groups/:groupId/policy-commit": 0,
  },
};

// Adding a brand-new admin requires two signed mutations: Members first, then
// Admins. The Members mutation establishes the roster and causes one billing
// refresh. Each group successor is paired with its signed organization-policy
// successor and dependent root rematerialization in one commit. Those container
// changes advance the organization feed, so the two active panes may consume
// several cursor positions. Standalone share POSTs stay pinned at zero because
// a separately committed repair would reintroduce the recovery gap this flow is
// meant to close.
const ADMIN_GROUP_MUTATION_REQUEST_BUDGET = {
  // Private metadata-root authority adds bounded directory/Admins reads to
  // compact projection recovery. Measured completed calls are 199–203; allow
  // one extra destination check. Preparation continuations are counted below.
  total: 207,
  // Public parent keys measure 389.5 KB sent with one descendant recitation;
  // retain room for the second 60 KB recitation already allowed below.
  // Completing child hydration adds the peer's system-slot proofs and their
  // metadata paths and private current policy proofs: 4.35 MB received. Each
  // document carries one shared proof bundle for all of its authorizing paths.
  bodyBytes: { request: 450_000, response: 4_500_000 },
  byRequest: {
    "GET /principals/history": 84,
    "GET /containers": 0,
    "POST /containers/parent-lanes/query": 8,
    "GET /principals/group/:groupId/policy": 33,
    "GET /containers/:containerId/documents": 6,
    "GET /documents/:documentId/writer-projection": 9,
    "POST /documents/:documentId/sync": 12,
    "GET /auth/user-identity/:userId": 2,
    "GET /organizations/:organizationId/read-model": 6,
    "GET /organizations/:organizationId/groups/:groupId/containers": 0,
    "GET /organizations/:organizationId/groups/:groupId/members": 1,
    // Includes first classification of all newly visible system slots, roots,
    // and fresh container info; blocked child hydration used only five.
    "GET /containers/:containerId/writer-projection": 7,
    "GET /organizations/:organizationId/directory": 0,
    "GET /organizations/:organizationId/groups": 0,
    "GET /organizations/:organizationId/data-usage": 0,
    "GET /organizations/:organizationId/grants": 0,
    "GET /organizations/:organizationId/billing": 1,
    "GET /principals/organization/:organizationId/policy": 45,
    "POST /containers/:containerId/share": 0,
    "PUT /organizations/:organizationId/groups/:groupId/policy-commit": 2,
    "POST /containers/:containerId/recite": 2,
  },
} satisfies ProxiedApiRequestBudget;
afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "adding a peer to the Admins group stays within its network request budget",
  async () => {
    useTestApiAppHandlers();
    const trees = new Map<PaneSide, ContainerContentsStore>();
    const view = renderDualPane({
      children: <ContainerTreeProbe trees={trees} />,
    });
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    // Contacts is promoted after authentication, separately from the eager
    // Trash provisioning. Wait for both panes' promotion before measuring
    // navigation so its container creation is not attributed to org manager.
    await waitForCondition(
      () =>
        listProxiedApiRequests().filter(
          (request) =>
            request.method === "POST" &&
            request.status === 200 &&
            request.url.includes("/containers/with-metadata-document"),
        ).length >= 2,
      "Both panes did not promote Contacts to remote sync.",
      POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    );
    // Settle both panes' provisioning/backfill so the admin-add slice measured
    // below is isolated from unrelated background convergence churn.
    let provisioningSettled = false;
    await act(async () => {
      provisioningSettled = await waitForAppTestRuntimeToSettle({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
      });
    });
    expect(provisioningSettled).toBe(true);
    // Login can precede reconciliation of the device-local root into the
    // registered root. Capture the shared parent only after startup settles.
    const founderRootId = trees
      .get("left")
      ?.getSnapshot()
      .nodes.find((node) => node.parentId === null && !node.systemSlot)?.id;
    if (!founderRootId) throw new Error("Founder root was not provisioned");
    profileProxiedApiRequests("provisioning + settle", 0);

    const adminAddBaseline = capturePostShareSyncBaseline();
    let mutationRequestStartIndex = adminAddBaseline.requestStartIndex;
    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane), () => {
      mutationRequestStartIndex = listProxiedApiRequests().length;
      profileProxiedApiRequests(
        "open org manager + select Admins",
        adminAddBaseline.requestStartIndex,
        mutationRequestStartIndex,
      );
    });
    // Background discovery also verifies signatures between network requests;
    // a quiet API and settled sync lanes alone do not mean its tree is ready.
    await waitForCondition(
      async () => {
        // Discovery routes newly visible containers through React effects.
        // Flush each poll; one act around the whole wait can hold those effects
        // until after the hydration it is waiting for has timed out.
        await act(async () => {});
        const names =
          trees
            .get("right")
            ?.getSnapshot()
            .nodes.filter((node) => node.parentId === founderRootId)
            .map((node) => node.name) ?? [];
        return names.includes("Contacts") && names.includes("Trash");
      },
      "Shared system folders did not finish hydrating.",
      POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    ).catch((error: unknown) => {
      console.error(
        "Hydration diagnostics",
        JSON.stringify({
          founderRootId,
          left: trees.get("left")?.getSnapshot(),
          right: trees.get("right")?.getSnapshot(),
          rightPane: rightPane.textContent,
          requests: listProxiedApiRequests().map((request) => ({
            method: request.method,
            url: request.url,
            status: request.status,
          })),
        }),
      );
      throw error;
    });
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      adminAddBaseline,
    );
    // A low request count must not pass because a stale discovery page blocked
    // every child. The peer must finish hydrating the granted system folders.
    const sharedNames = trees
      .get("right")
      ?.getSnapshot()
      .nodes.filter((node) => node.parentId === founderRootId)
      .map((node) => node.name);
    expect(sharedNames).toEqual(expect.arrayContaining(["Contacts", "Trash"]));

    const adminAddRequests = listProxiedApiRequests().slice(
      adminAddBaseline.requestStartIndex,
    );
    const navigationRequests = adminAddRequests.slice(
      0,
      mutationRequestStartIndex - adminAddBaseline.requestStartIndex,
    );
    const mutationRequests = listProxiedApiRequests().slice(
      mutationRequestStartIndex,
    );
    const syncIntents = documentSyncIntentCounts(mutationRequests);
    profileProxiedApiRequests(
      "admin-group add + settle",
      adminAddBaseline.requestStartIndex,
    );
    profileProxiedApiRequests(
      "admin-group mutation + settle",
      mutationRequestStartIndex,
    );

    expectProxiedApiRequestBudget(
      "open org manager and select Admins",
      navigationRequests,
      ADMIN_GROUP_OPEN_REQUEST_BUDGET,
    );
    const pendingHistory = mutationRequests.filter(
      (request) =>
        request.method === "GET" &&
        new URL(request.url).pathname === "/principals/history" &&
        request.status === 202,
    );
    expect(pendingHistory.length).toBeLessThanOrEqual(1);
    for (const request of pendingHistory)
      expect(JSON.parse(request.responseBody)).toEqual({
        code: "principal_history_preparation_pending",
        committed: false,
        progressToken: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
    expectProxiedApiRequestBudget("admin-group mutation", mutationRequests, {
      ...ADMIN_GROUP_MUTATION_REQUEST_BUDGET,
      total: ADMIN_GROUP_MUTATION_REQUEST_BUDGET.total + pendingHistory.length,
      byRequest: {
        ...ADMIN_GROUP_MUTATION_REQUEST_BUDGET.byRequest,
        "GET /principals/history":
          ADMIN_GROUP_MUTATION_REQUEST_BUDGET.byRequest[
            "GET /principals/history"
          ] + pendingHistory.length,
        // Either membership commit can advance root key targets while a
        // peer's read-only sync is in flight. A real stale-target response
        // requires one fresh projection; do not grant that allowance when
        // no conflict occurred, or relax the total/byte budgets.
        "GET /documents/:documentId/writer-projection":
          9 + staleTargetRefreshCount(mutationRequests),
      },
    });
    // The extra settle rounds are read-only; a membership add still writes
    // nothing through the document sync lane, however many mutations it takes.
    expect(syncIntents.writeBearing).toBe(0);
    expect(syncIntents.readOnly).toBeLessThanOrEqual(12);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

function staleTargetRefreshCount(
  requests: ReturnType<typeof listProxiedApiRequests>,
): number {
  const stale = requests.filter(
    (request) =>
      request.method === "POST" &&
      new URL(request.url).pathname.startsWith("/documents/") &&
      new URL(request.url).pathname.endsWith("/sync") &&
      request.status === 409 &&
      isDocumentSyncStateStaleErrorResponse(JSON.parse(request.responseBody)),
  ).length;
  expect(stale).toBeLessThanOrEqual(1);
  return stale;
}
