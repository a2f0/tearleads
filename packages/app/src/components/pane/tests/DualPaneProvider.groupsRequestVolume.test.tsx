import { afterEach, test } from "bun:test";
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

// Baseline for the org-manager "add a user to the Admins group" gesture, measured
// on the isolated admin-add slice (after both panes finish provisioning/backfill).
//
// Observed at exactly 84 requests, deterministic across repeated runs. Only TWO of
// those requests actually mutate server state:
//   PUT  /principals/group/:groupId/policy   -- the add-member write itself
//   POST /containers/:containerId/share      -- reshare the org root to the new
//                                               Admins key epoch (Admins-only path)
// Everything else is read / reconcile / refresh convergence:
//   * 26 GET /containers -- every reconcile and every server event re-lists the
//     whole root container set on BOTH panes, because sync events are hints, not
//     deltas (#1281 phase A). This single bucket is ~a third of the whole flow and
//     is the first thing to scope if we want to bring this number down.
//   * 11 GET /principals/group/:groupId/policy -- the add workflow reads the group
//     policy for its mutation context and again to cache the committed bundle, and
//     the org-manager refreshers re-read it after the write.
//   * GET /containers/:id/documents, GET /documents/:id/writer-projection, and
//     POST /documents/:id/sync -- shared-subtree document convergence.
//   * The org-manager post-mutation reload fan-out (refreshDirectoryAndGroups +
//     refreshSelectedGroupDetails + refreshSelectedUserDetail): directory, groups,
//     group members/containers, grants, data-usage, and the org principal policy.
//
// The ceilings carry modest headroom over the observed counts to absorb race timing
// without masking a regression: a re-sync loop or a duplicated refresh fan-out would
// blow well past `total`, and the mutation writes are pinned tight (2 each) to catch
// an accidental double-write. Re-profile with DUAL_PANE_REQUEST_PROFILE=1 to see the
// current per-endpoint breakdown when a change moves these numbers.
const ADMIN_GROUP_ADD_REQUEST_BUDGET: ProxiedApiRequestBudget = {
  total: 96,
  byRequest: {
    "GET /containers": 30,
    "GET /principals/group/:groupId/policy": 14,
    "GET /containers/:containerId/documents": 12,
    "GET /documents/:documentId/writer-projection": 10,
    "POST /documents/:documentId/sync": 10,
    "GET /organizations/:organizationId/directory": 5,
    "GET /auth/user-identity/:userId": 3,
    "GET /organizations/:organizationId/groups": 3,
    "GET /organizations/:organizationId/data-usage": 3,
    "GET /organizations/:organizationId/grants": 3,
    "GET /organizations/:organizationId/groups/:groupId/containers": 3,
    "GET /organizations/:organizationId/groups/:groupId/members": 3,
    "GET /principals/organization/:organizationId/policy": 3,
    "GET /containers/:containerId/writer-projection": 2,
    // The two mutation writes. Pinned to exactly 1 (their observed count): a
    // ceiling of 2 would let an accidental double-add or a redundant second root
    // reshare slip under the total budget, which is the regression this test
    // exists to catch. A legitimate retry of either write signals a real problem.
    "POST /containers/:containerId/share": 1,
    "PUT /principals/group/:groupId/policy": 1,
  },
};

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
    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      adminAddBaseline,
    );

    const adminAddRequests = listProxiedApiRequests().slice(
      adminAddBaseline.requestStartIndex,
    );
    profileProxiedApiRequests(
      "admin-group add + settle",
      adminAddBaseline.requestStartIndex,
    );

    expectProxiedApiRequestBudget(
      "admin-group add",
      adminAddRequests,
      ADMIN_GROUP_ADD_REQUEST_BUDGET,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
