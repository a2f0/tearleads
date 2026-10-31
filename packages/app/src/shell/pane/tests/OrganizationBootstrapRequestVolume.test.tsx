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
        // Measured 30 calls: private metadata-root authority adds one directory
        // discovery read per operation. Provisioning primes the founding
        // policy heads, so their first recovery reads no group history.
        // Batched discovery lists the four lanes queued at startup in one
        // request and a later-surfaced lane in a second.
        // Login returns the first websocket ticket, so no ticket request. The
        // self contact's create carries its queued content as its seed, so no
        // content sync (and its discovery read) follows.
        // A hydration pass discovers the directory once (measured 30, 31
        // before); a discovery naming the held head receives that head alone.
        total: 31,
        // Provisioned containers are acknowledged by hash, not echoed: 322 KB
        // sent and 233 KB received (305 KB before; register 118 KB -> 63 KB).
        bodyBytes: { request: 355_000, response: 256_000 },
        byRequest: {
          "GET /principals/organization/:organizationId/policy": 5,
          "GET /principals/group/:groupId/policy": 0,
          // Compact projections read each new public head once; completed
          // stages need no confirmation read.
          "GET /principals/history": 3,
          "POST /containers/documents/query": 2,
          "POST /documents/:documentId/sync": 7,
          "POST /containers/parent-lanes/query": 5,
          "GET /containers/:containerId/writer-projection": 4,
          // Provisioning commits the root's metadata, so no device-first copy
          // is replayed through a document projection. Discovery reuses the
          // signed heads of the seeded profile documents.
          "GET /documents/:documentId/writer-projection": 0,
          "GET /organizations/:organizationId/billing": 1,
          "POST /auth/register": 1,
          "POST /auth/verify": 1,
          "POST /auth/ws-ticket": 0,
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
        // Verify the new metadata root through private current policy evidence;
        // provisioning primed its founding heads, leaving one discovery read.
        total: 6,
        // Provisioned containers are acknowledged by hash, not echoed: 230 KB
        // sent and 76 KB received (132 KB before; the create 118 KB -> 63 KB).
        bodyBytes: { request: 254_000, response: 84_000 },
        byRequest: {
          "GET /principals/organization/:organizationId/policy": 1,
          "GET /principals/group/:groupId/policy": 0,
          // Provisioning seeds the organization profile document's signed
          // head, so discovery needs no projection or public history for it.
          "GET /documents/:documentId/writer-projection": 0,
          "GET /principals/history": 0,
          // One batched listing covers every lane of the new organization.
          "POST /containers/documents/query": 1,
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
