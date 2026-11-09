import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createOrganizationGroup,
  openOrgManager,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { requestPath } from "../../../../test/helpers/dualPaneRequestSummary";
import { createPeerIdentityLink } from "../../../../test/helpers/identityLinkFixtures";
import {
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import { profileProxiedApiRequests } from "../../../../test/helpers/proxiedApiRequestBudget";
import { documentSyncIntentCounts } from "../../../../test/helpers/proxiedApiRequestMetrics";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test("group creation and adding a peer have separate request budgets", async () => {
  useTestApiAppHandlers();
  const view = renderDualPane();
  const pane = getPaneRoot(view, "left");
  const peer = getPaneRoot(view, "right");
  await waitForDualPaneProvisioning(pane, peer);
  await waitForPersonalBootstrap(2);
  await openOrgManager(pane);
  const peerId = getPaneUserId(peer);
  for (const group of ["first", "second"] as const) {
    await waitForPaneRuntimeToSettle(20_000);
    const pairStart = listProxiedApiRequests().length;
    await measureWorkflowRequests({
      label: `create ${group} organization group`,
      operation: () => createOrganizationGroup(pane, `Budget ${group} group`),
      budget: {
        // Measured 8/5 requests. Bootstrap no longer reads the roster profile
        // container's projection (its role is seeded), so the first group
        // create reads it and its Admins history; the read-model hint carries
        // its cursor, so one read-model read follows the create. Allow three
        // directory/Admins reads to move across the phase boundary; metadata
        // unwrap reuses exact local evidence.
        total: group === "first" ? 11 : 8,
        byRequest: {
          "GET /principals/history": group === "first" ? 2 : 1,
          "GET /containers/:containerId/writer-projection":
            group === "first" ? 2 : 1,
          "GET /organizations/:organizationId/read-model": 1,
          "GET /principals/group/:groupId/policy": 1,
          "GET /principals/organization/:organizationId/policy": 2,
          "POST /organizations/:organizationId/groups": 1,
        },
      },
      mutations: [
        {
          method: "POST",
          path: /^\/organizations\/[^/]+\/groups$/u,
          count: 1,
          maxPreparations: 1,
        },
      ],
    });
    const membershipRequests = await measureWorkflowRequests({
      label: `add peer to ${group} custom group`,
      operation: async () => {
        const input = within(pane).getByLabelText(
          "Roster user or identity link",
        );
        invariant(input instanceof HTMLInputElement, "Expected user id input");
        const peerIdentityLink = await createPeerIdentityLink(peerId);
        await interact(() => {
          fireEvent.change(input, { target: { value: peerIdentityLink } });
        });
        const add = within(pane).getByRole("button", { name: "Add" });
        await waitFor(() => {
          expect(add.hasAttribute("disabled")).toBe(false);
        });
        await interact(() => {
          fireEvent.click(add);
        });
        await waitFor(
          () => {
            expect(input.value).toBe("");
            expect(
              Array.from(pane.querySelectorAll("strong")).some(
                (element) => element.getAttribute("title") === peerId,
              ),
            ).toBe(true);
          },
          { timeout: 15_000 },
        );
      },
      budget: {
        // The first add enrolls the peer in Members and the custom group in
        // one write, including metadata discovery, read-only sync, and billing.
        // The second add reuses the roster membership.
        // First enrollment measures 38 calls with private metadata-root
        // authority, its group create included (30 for the add itself). The
        // add applies the SDK's post-commit read model instead of reading it
        // again, and the hint naming that cursor costs no read (later adds
        // measure 6). Keep five reads of phase headroom; later adds get three.
        total: group === "first" ? 43 : 9,
        byRequest: {
          "GET /principals/history": group === "first" ? 8 : 2,
          "GET /containers/:containerId/writer-projection":
            group === "first" ? 3 : 1,
          "GET /organizations/:organizationId/read-model":
            group === "first" ? 2 : 1,
          "GET /principals/group/:groupId/policy": group === "first" ? 3 : 1,
          "GET /auth/user-identity/:userId": group === "first" ? 2 : 0,
          "GET /principals/organization/:organizationId/policy":
            group === "first" ? 10 : 2,
          "PUT /organizations/:organizationId/groups/:groupId/policy-commit": 1,
          // A concurrent policy advance can require a fresh post-create proof.
          "GET /documents/:documentId/writer-projection":
            group === "first" ? 3 : 0,
          "POST /documents/:documentId/sync": group === "first" ? 3 : 0,
          "POST /containers/parent-lanes/query": group === "first" ? 2 : 0,
          "POST /containers/documents/query": group === "first" ? 1 : 0,
          "GET /organizations/:organizationId/billing":
            group === "first" ? 1 : 0,
          "GET /organizations/:organizationId/groups/:groupId/members": 1,
        },
      },
      mutations: [
        {
          method: "PUT",
          path: /^\/organizations\/[^/]+\/groups\/[^/]+\/policy-commit$/u,
          count: 1,
        },
      ],
    });
    expect(documentSyncIntentCounts(membershipRequests).writeBearing).toBe(0);
    const commit = membershipRequests.find(
      (request) =>
        request.method === "PUT" && request.url.endsWith("/policy-commit"),
    );
    invariant(commit, "Expected a membership commit");
    invariant(commit.requestBody, "Expected a membership request body");
    const body: unknown = JSON.parse(commit.requestBody);
    if (group === "first") expect(body).toHaveProperty("memberPolicy");
    else expect(body).not.toHaveProperty("memberPolicy");
    // The first pair adds private metadata-root authority reads. Phase margins
    // cannot accumulate across creation and membership changes.
    const combined = listProxiedApiRequests().slice(pairStart);
    profileProxiedApiRequests(
      `create and add peer to ${group} group`,
      pairStart,
    );
    expect(combined.length).toBeLessThanOrEqual(group === "first" ? 50 : 14);
    expect(
      combined.filter(
        (request) =>
          request.method === "GET" &&
          requestPath(request.url) === "/principals/history",
      ).length,
    ).toBeLessThanOrEqual(group === "first" ? 11 : 3);
  }
}, 90_000);
