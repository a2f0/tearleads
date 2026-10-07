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
import { useTestApiAppHandlers } from "../../../../test/helpers/mswServer";
import { cleanupPaneTestEnvironment } from "../../../../test/helpers/paneTestUtils";
import { documentSyncIntentCounts } from "../../../../test/helpers/proxiedApiRequestMetrics";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment);

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
    const creationRequests = await measureWorkflowRequests({
      label: `create ${group} organization group`,
      operation: () => createOrganizationGroup(pane, `Budget ${group} group`),
      budget: {
        // Obtain the verified organization metadata key before encrypting the name.
        total: 16,
        byRequest: {
          "GET /principals/history": 9,
          "GET /containers/:containerId/writer-projection": 1,
          "GET /organizations/:organizationId/read-model": 2,
          "GET /principals/group/:groupId/policy": 2,
          "GET /principals/organization/:organizationId/policy": 1,
          "POST /organizations/:organizationId/groups": 1,
        },
      },
      mutations: [
        { method: "POST", path: /^\/organizations\/[^/]+\/groups$/u, count: 1 },
      ],
    });
    const membershipRequests = await measureWorkflowRequests({
      label: `add peer to ${group} custom group`,
      operation: async () => {
        const input = within(pane).getByLabelText("User ID");
        invariant(input instanceof HTMLInputElement, "Expected user id input");
        await interact(() => {
          fireEvent.change(input, { target: { value: peerId } });
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
        // The first add enrolls the peer in Members before the custom group,
        // including metadata discovery, read-only sync, and a billing refresh.
        // The second add reuses that roster membership and stays a single write.
        // Metadata verification may finish in either creation or membership.
        // The combined budget below keeps their total work unchanged.
        total: group === "first" ? 75 : 22,
        byRequest: {
          "GET /principals/history": group === "first" ? 42 : 12,
          "GET /containers/:containerId/writer-projection":
            group === "first" ? 3 : 1,
          "GET /organizations/:organizationId/read-model":
            group === "first" ? 4 : 3,
          "GET /principals/group/:groupId/policy": group === "first" ? 8 : 3,
          "GET /auth/user-identity/:userId": group === "first" ? 2 : 0,
          "GET /principals/organization/:organizationId/policy":
            group === "first" ? 3 : 1,
          "PUT /organizations/:organizationId/groups/:groupId/policy-commit":
            group === "first" ? 2 : 1,
          // A concurrent policy advance can require a fresh post-create proof.
          "GET /documents/:documentId/writer-projection":
            group === "first" ? 3 : 0,
          "POST /documents/:documentId/sync": group === "first" ? 3 : 0,
          "POST /containers/parent-lanes/query": group === "first" ? 2 : 0,
          "GET /containers/:containerId/documents": group === "first" ? 1 : 0,
          "GET /organizations/:organizationId/billing":
            group === "first" ? 1 : 0,
          "GET /organizations/:organizationId/groups/:groupId/members": 1,
        },
      },
      mutations: [
        {
          method: "PUT",
          path: /^\/organizations\/[^/]+\/groups\/[^/]+\/policy-commit$/u,
          count: group === "first" ? 2 : 1,
        },
      ],
    });
    expect(documentSyncIntentCounts(membershipRequests).writeBearing).toBe(0);
    const combined = [...creationRequests, ...membershipRequests];
    expect(combined.length).toBeLessThanOrEqual(group === "first" ? 91 : 35);
    expect(
      combined.filter(
        (request) =>
          request.method === "GET" &&
          requestPath(request.url) === "/principals/history",
      ).length,
    ).toBeLessThanOrEqual(group === "first" ? 51 : 18);
  }
}, 90_000);
