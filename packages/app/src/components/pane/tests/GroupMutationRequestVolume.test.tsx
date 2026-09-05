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
import { useTestApiAppHandlers } from "../../../../test/helpers/mswServer";
import { cleanupPaneTestEnvironment } from "../../../../test/helpers/paneTestUtils";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment);

test("group creation and adding a peer have separate request budgets", async () => {
  useTestApiAppHandlers();
  const view = renderDualPane();
  const pane = getPaneRoot(view, "left");
  const peer = getPaneRoot(view, "right");
  await waitForDualPaneProvisioning(pane, peer);
  await openOrgManager(pane);
  const peerId = getPaneUserId(peer);
  for (const group of ["first", "second"] as const) {
    await measureWorkflowRequests({
      label: `create ${group} organization group`,
      operation: () => createOrganizationGroup(pane, `Budget ${group} group`),
      budget: {
        total: 6,
        byRequest: {
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
    await measureWorkflowRequests({
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
              pane.querySelector(`strong[title="${peerId}"]`) !== null,
            ).toBe(true);
          },
          { timeout: 15_000 },
        );
      },
      budget: {
        total: group === "first" ? 9 : 8,
        byRequest: {
          "GET /organizations/:organizationId/read-model": 3,
          "GET /principals/group/:groupId/policy": 3,
          "GET /auth/user-identity/:userId": group === "first" ? 1 : 0,
          "GET /principals/organization/:organizationId/policy": 1,
          "PUT /organizations/:organizationId/groups/:groupId/policy-commit": 1,
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
  }
}, 90_000);
