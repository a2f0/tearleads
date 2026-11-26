import { afterEach, expect, test } from "bun:test";
import { waitFor, within } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  renderSinglePane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { openOrgManager } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { createAdditionalOrganization } from "../../../../test/helpers/dual-pane/organizationCreation";
import { requestPath } from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import type { ProxiedApiRequest } from "../../../../test/helpers/proxiedApiResponse";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

function seededDocumentIds(response: unknown): string[] {
  const read = (value: unknown, ...path: string[]): unknown =>
    path.reduce<unknown>(
      (current, key) =>
        typeof current === "object" && current !== null
          ? Reflect.get(current, key)
          : undefined,
      value,
    );
  const systemContainers = read(response, "systemContainers");
  return [
    read(response, "rootMetadataDocumentId"),
    read(response, "rosterProfileContainer", "metadataDocument", "id"),
    read(response, "rosterProfileDocumentId"),
    read(response, "organizationMetadataContainer", "metadataDocument", "id"),
    read(response, "organizationProfileDocumentId"),
    ...(Array.isArray(systemContainers)
      ? systemContainers.map((item) => read(item, "metadataDocument", "id"))
      : []),
  ].filter((id): id is string => typeof id === "string");
}

/**
 * A seeded document's first read sends registration's commit position. An
 * additional organization reports none, so its seeded first reads send none.
 */
function expectSeededFirstSyncs(
  requests: readonly ProxiedApiRequest[],
  provisioningPath: RegExp,
  position: "position" | "none",
): void {
  const provisioning = requests.find(
    (request) =>
      request.method === "POST" &&
      provisioningPath.test(requestPath(request.url)) &&
      request.status === 200,
  );
  if (!provisioning) throw new Error("Expected a provisioning response");
  const response: unknown = JSON.parse(provisioning.responseBody);
  const commitLsn = Reflect.get(Object(response), "commitLsn");
  expect(typeof commitLsn).toBe(
    position === "position" ? "string" : "undefined",
  );
  const firstSyncs = seededDocumentIds(response).flatMap((documentId) => {
    const sync = requests.find((request) =>
      requestPath(request.url).endsWith(`/documents/${documentId}/sync`),
    );
    return sync ? [sync] : [];
  });
  expect(firstSyncs.length).toBeGreaterThan(0);
  for (const sync of firstSyncs) {
    expect(
      Reflect.get(Object(JSON.parse(sync.requestBody ?? "{}")), "minLsn"),
    ).toBe(commitLsn);
  }
}

test(
  "personal organization bootstrap has a complete request budget",
  async () => {
    useTestApiAppHandlers();
    const bootstrap = await measureWorkflowRequests({
      label: "personal organization bootstrap",
      operation: async () => {
        const pane = getPaneRoot(renderSinglePane(), "left");
        await waitForSinglePaneProvisioning(pane);
        await openExplorer(pane);
        await waitFor(() => {
          for (const name of ["Contacts", "Trash"]) {
            expect(
              getExplorerSidebarItemsByName(pane, name).length,
            ).toBeGreaterThan(0);
          }
        });
        const table = await selectContainerAndWaitForItemTable(
          pane,
          "Contacts",
        );
        await within(table).findByRole("button", { name: "You" });
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
        // root-lane pass. Provisioning seeds the destination roles of the
        // containers it created, so hydration reads no projection for them;
        // the one signed destination read is the root's, for the Contacts
        // create. Private metadata-root authority adds one directory
        // discovery read per operation. Provisioning primes the founding
        // policy heads, so their first recovery reads no group history.
        // Batched discovery lists the four lanes queued at startup in one
        // request and a later-surfaced lane in a second.
        // Login returns the first websocket ticket, so no ticket request. The
        // Contacts create carries its first metadata update, so no content
        // sync follows it. Contacts is made device-first, so
        // its create replays its own intent in a sync pass (one more root-lane
        // query and policy read) instead of an eager create racing it.
        // A hydration pass discovers the directory once, and a coordinator
        // drain's syncs share one operation; a discovery naming the held head
        // receives that head alone. Provisioning returns its commit position,
        // so the seeded documents skip their empty first syncs. Without those
        // syncs ahead of it, the self contact's create now runs before its
        // content is queued (it used to carry that content as its seed), so an
        // empty read and one write follow it. Measured 20 calls (24 before the
        // tree crawl listed its parent lanes in one request, 26 before the
        // provisioning commit position, 29 with drain-scoped operations alone,
        // 30 before either, 31 before that).
        total: 21,
        // Provisioned containers and documents are acknowledged by hash, not
        // echoed, seeded roles skip three destination projections, and syncs
        // no longer echo the bundle and KEK targets the request named: 61 KB
        // received (70 KB before the sync echo went, 157 KB before seeded
        // roles; register 118 KB -> 63 KB). Public history reads name the
        // founding heads registration holds and receive no current state:
        // 42 KB received. Served bundles leave off the state their signed
        // bytes name: 39.8 KB received. Acknowledgements name each authored
        // head's served digest and the device caches the matching bundles it
        // built, so later reads cite them: 29.7 KB received; keep about 5%
        // headroom. Keys and the login signature travel as base64 and child
        // containers cite their parent KEK state: 291 KB sent (322 KB before).
        // Container mutations send manifest hashes alone: 287.9 KB sent;
        // sending the manifests again (291.5 KB) exceeds this ceiling. The
        // projection cites the held organization directory: 28.4 KB received
        // (29.7 KB with it, which exceeds this ceiling).
        // Seeds carry their update alone and document creates send manifest
        // hashes alone: 274.0 KB sent; the full seeds and create manifests
        // (287.1 KB) exceed this ceiling.
        bodyBytes: { request: 280_000, response: 29_000 },
        byRequest: {
          "GET /principals/organization/:organizationId/policy": 5,
          "GET /principals/group/:groupId/policy": 0,
          // Compact projections read each new public head once; completed
          // stages need no confirmation read.
          "GET /principals/history": 2,
          // The catch-up waits for the tree crawl, so the lanes that crawl
          // discovers are listed from the queue first and once more by the
          // catch-up, which reads what is owed before that listing settles.
          "POST /containers/documents/query": 3,
          // Measured 4 (6 before the provisioning commit position): the root
          // twice, as a second root-lane pass can sync it again, and the self
          // contact's read and write.
          "POST /documents/:documentId/sync": 5,
          // Measured 1: a crawl lists every parent lane in one request.
          "POST /containers/parent-lanes/query": 2,
          "GET /containers/:containerId/writer-projection": 1,
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
    expectSeededFirstSyncs(bootstrap, /^\/auth\/register$/u, "position");
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
    const creation = await measureWorkflowRequests({
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
        // Provisioned containers and documents are acknowledged by hash, not
        // echoed, nor does the sync echo its bundle and KEK targets: 17.9 KB
        // received (19.4 KB before; 132 KB before hash acknowledgements).
        // Child containers cite their parent KEK state: 223 KB sent (230 KB
        // before). Container creates send manifest hashes alone: 220.0 KB.
        // Seeds carry their update alone and document creates send manifest
        // hashes alone: 209.4 KB (220.0 KB with them exceeds this ceiling).
        bodyBytes: { request: 215_000, response: 20_000 },
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
    expectSeededFirstSyncs(creation, /^\/organizations$/u, "none");
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
