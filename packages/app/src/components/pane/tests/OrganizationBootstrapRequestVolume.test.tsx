import { afterEach, expect, test } from "bun:test";
import { waitFor, within } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  renderSinglePane,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { openOrgManager } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { createAdditionalOrganization } from "../../../../test/helpers/dual-pane/organizationCreation";
import {
  listProxiedApiRequests,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment);

test(
  "personal organization bootstrap has a complete request budget",
  async () => {
    useTestApiAppHandlers();
    await measureWorkflowRequests({
      label: "personal organization bootstrap",
      operation: async () => {
        const pane = getPaneRoot(renderSinglePane(), "left");
        await waitForSinglePaneProvisioning(pane);
        await openExplorer(pane);
        await waitFor(() => {
          for (const name of ["Contacts", "Trash", "You"]) {
            expect(
              getExplorerSidebarItemsByName(pane, name).length,
            ).toBeGreaterThan(0);
          }
        });
      },
      mutations: [
        { method: "POST", path: /^\/auth\/register$/u, count: 1 },
        {
          method: "POST",
          path: /^\/containers\/with-metadata-document$/u,
          count: 1,
        },
        { method: "POST", path: /^\/documents$/u, count: 1 },
      ],
      budget: {
        // Root acknowledgement and verified adoption can each schedule a
        // root-lane pass; signed destination reads remain bounded at four.
        total: 29,
        byRequest: {
          "GET /containers/:containerId/documents": 5,
          "POST /documents/:documentId/sync": 8,
          "POST /containers/parent-lanes/query": 5,
          "GET /containers/:containerId/writer-projection": 4,
          "GET /documents/:documentId/writer-projection": 1,
          "GET /organizations/:organizationId/billing": 1,
          "POST /auth/register": 1,
          "POST /auth/verify": 1,
          "POST /auth/ws-ticket": 1,
          "POST /containers/with-metadata-document": 1,
          "POST /documents": 1,
        },
      },
    });
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "additional organization creation and activation have a complete request budget",
  async () => {
    useTestApiAppHandlers();
    const pane = getPaneRoot(renderSinglePane(), "left");
    await waitForSinglePaneProvisioning(pane);
    // Contacts promotion starts after authentication. Its remote commits must
    // finish before measuring creation of a different organization.
    await waitFor(
      () => {
        const committedPosts = listProxiedApiRequests().filter(
          (request) => request.method === "POST" && request.status === 200,
        );
        for (const path of [
          "/containers/with-metadata-document",
          "/documents",
        ]) {
          expect(
            committedPosts.some((request) => request.url.endsWith(path)),
          ).toBe(true);
        }
      },
      { timeout: 20_000 },
    );
    await openOrgManager(pane);
    await waitForPaneRuntimeToSettle(20_000);
    await measureWorkflowRequests({
      label: "additional organization creation + activation",
      operation: async () => {
        await createAdditionalOrganization(pane, "Request budget org");
        await waitFor(() => {
          expect(
            within(pane).getByRole("combobox", { name: "Organizations" })
              .textContent,
          ).toContain("Request budget org");
        });
      },
      mutations: [{ method: "POST", path: /^\/organizations$/u, count: 1 }],
      budget: {
        total: 8,
        byRequest: {
          "GET /containers/:containerId/documents": 4,
          "GET /organizations/:organizationId/billing": 1,
          "GET /organizations/:organizationId/read-model": 1,
          "POST /documents/:documentId/sync": 1,
          "POST /organizations": 1,
        },
      },
    });
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
