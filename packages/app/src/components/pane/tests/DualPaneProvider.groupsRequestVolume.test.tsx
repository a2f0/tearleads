import { afterEach, expect, test } from "bun:test";
import { act, cleanup } from "@testing-library/react";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
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

// #1565 originally measured the whole open-and-add gesture at 84 requests;
// #1566 reduced it to 69. The #1500 membership projection reduces the
// deterministic profile to 1 request to open/select Admins. Parent-lane
// batching then reduces click-through convergence from a 47-request median to
// a 43-request maximum. Reusing an exact, independently verified local policy
// chain for reference-bound checks reduces the mutation to 40 requests in each
// of ten runs; freshness-sensitive mutation and current-head reads stay remote.
// Keep navigation and mutation separate so UI reads cannot hide a sync
// regression. Only the atomic group-policy commits are writes.
// The second read-model GET is the deferred author-echo release: a
// session-scoped origin flag cannot prove the deferred hint was this client's
// own echo (a sibling client shares the login session), so the release
// reconciles the feed instead of trusting a repaint shortcut. Per-client
// origin attribution under #1512 can reclaim it. The unopened peer Org
// Manager still declares no demand and performs no organization feed GET.
const ADMIN_GROUP_OPEN_REQUEST_BUDGET: ProxiedApiRequestBudget = {
  total: 1,
  byRequest: {
    "GET /organizations/:organizationId/read-model": 1,
    "GET /organizations/:organizationId/groups/:groupId/containers": 0,
    "GET /organizations/:organizationId/groups/:groupId/members": 0,
    "GET /principals/group/:groupId/policy": 0,
    "GET /organizations/:organizationId/directory": 0,
    "GET /organizations/:organizationId/data-usage": 0,
    "GET /organizations/:organizationId/grants": 0,
    "GET /organizations/:organizationId/groups": 0,
    "GET /principals/organization/:organizationId/policy": 0,
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
const ADMIN_GROUP_MUTATION_REQUEST_BUDGET: ProxiedApiRequestBudget = {
  total: 52,
  byRequest: {
    "GET /containers": 0,
    "POST /containers/parent-lanes/query": 13,
    "GET /principals/group/:groupId/policy": 10,
    "GET /containers/:containerId/documents": 9,
    "GET /documents/:documentId/writer-projection": 11,
    "POST /documents/:documentId/sync": 12,
    "GET /auth/user-identity/:userId": 2,
    "GET /organizations/:organizationId/read-model": 6,
    "GET /organizations/:organizationId/groups/:groupId/containers": 0,
    "GET /organizations/:organizationId/groups/:groupId/members": 1,
    "GET /containers/:containerId/writer-projection": 3,
    "GET /organizations/:organizationId/directory": 0,
    "GET /organizations/:organizationId/groups": 0,
    "GET /organizations/:organizationId/data-usage": 0,
    "GET /organizations/:organizationId/grants": 0,
    "GET /organizations/:organizationId/billing": 1,
    "GET /principals/organization/:organizationId/policy": 2,
    "POST /containers/:containerId/share": 0,
    "PUT /organizations/:organizationId/groups/:groupId/policy-commit": 2,
  },
};
function documentSyncIntentCounts(
  requests: ReturnType<typeof listProxiedApiRequests>,
): { readOnly: number; writeBearing: number } {
  let readOnly = 0;
  let writeBearing = 0;
  for (const request of requests) {
    if (
      request.method !== "POST" ||
      !/^\/documents\/[^/]+\/sync$/u.test(new URL(request.url).pathname)
    ) {
      continue;
    }
    const body = JSON.parse(request.requestBody ?? "{}") as {
      outgoingUpdates?: unknown[] | undefined;
    };
    if ((body.outgoingUpdates?.length ?? 0) === 0) {
      readOnly += 1;
    } else {
      writeBearing += 1;
    }
  }
  return { readOnly, writeBearing };
}

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "adding a peer to the Admins group stays within its network request budget",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);
    // Settle both panes' provisioning/backfill so the admin-add slice measured
    // below is isolated from unrelated background convergence churn.
    await act(async () => {
      await waitForAppTestRuntimeToSettle({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
      });
    });
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
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      adminAddBaseline,
    );

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
    expectProxiedApiRequestBudget(
      "admin-group mutation",
      mutationRequests,
      ADMIN_GROUP_MUTATION_REQUEST_BUDGET,
    );
    // The extra settle rounds are read-only; a membership add still writes
    // nothing through the document sync lane, however many mutations it takes.
    expect(syncIntents.writeBearing).toBe(0);
    expect(syncIntents.readOnly).toBeLessThanOrEqual(12);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
