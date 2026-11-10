import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { waitFor } from "@testing-library/react";
import invariant from "invariant";
import { useEffect } from "react";
import {
  generatePaneKeyPairFromMenu,
  getExplorerSidebarItem,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  getPaneUserId,
  readPaneRecoveryKey,
  renderDualPane,
  restorePaneFromRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  openExplorer,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { requestPath } from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  expectLifecycleNotes,
  expectLifecycleReads,
  expectNoLateLifecycleRequests,
  observeReconnectSweep,
  renderLifecyclePane,
  seedLifecycleTree,
  setLifecycleNetworkMode,
  unmountLifecyclePane,
  waitForLifecycleConnection,
} from "../../../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { type PaneSide, usePaneSide } from "../dual-pane";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test("a settled pane reconnects with no pending local work", async () => {
  useTestApiAppHandlers();
  const fixture = renderLifecyclePane();
  await seedLifecycleTree(fixture.pane);
  const sdk = fixture.sdk();
  await waitForLifecycleConnection(sdk, 1);
  expect(
    await sdk.containerContents.documentQueries().listPendingWrites(),
  ).toEqual([]);
  using sweep = observeReconnectSweep(sdk);
  await measureWorkflowRequests({
    label: "disconnect without pending work",
    budget: { total: 0, byRequest: {} },
    mutations: [],
    operation: async () => {
      await setLifecycleNetworkMode(fixture.pane, true);
      await waitFor(() => expect(sdk.events.connected).toBe(false));
    },
  });
  const requests = await measureWorkflowRequests({
    label: "reconnect without pending work",
    budget: {
      total: 22,
      byRequest: {
        "POST /auth/ws-ticket": 1,
        "GET /organization-memberships": 1,
        "GET /organizations/:organizationId/billing": 0,
        "POST /containers/parent-lanes/query": 4,
        "POST /containers/documents/query": 1,
        "GET /principals/organization/:organizationId/policy": 3,
        "GET /principals/group/:groupId/policy": 0,
        "GET /principals/history": 0,
        "GET /containers/:containerId/writer-projection": 1,
        "GET /documents/:documentId/writer-projection": 3,
        "POST /documents/:documentId/sync": 8,
      },
    },
    mutations: [],
    operation: async () => {
      await setLifecycleNetworkMode(fixture.pane, false);
      await waitForLifecycleConnection(sdk, 2);
      await sweep.wait();
      expect(
        await sdk.containerContents.documentQueries().listPendingWrites(),
      ).toEqual([]);
    },
  });
  expectLifecycleReads(requests);
  await expectNoLateLifecycleRequests();
  await expectLifecycleNotes(fixture.pane);
  await unmountLifecyclePane(fixture);
}, 60_000);

function PeerSdkProbe({ sdks }: { sdks: Map<PaneSide, Tearleads> }) {
  const sdk = useTearleads();
  const side = usePaneSide();
  useEffect(() => {
    sdks.set(side, sdk);
  }, [sdks, side, sdk]);
  return null;
}

test("reconnect discovers one folder created by a peer while disconnected", async () => {
  useTestApiAppHandlers();
  const sdks = new Map<PaneSide, Tearleads>();
  const view = renderDualPane({
    autoProvisionRight: false,
    children: <PeerSdkProbe sdks={sdks} />,
  });
  const observer = getPaneRoot(view, "left");
  const peer = getPaneRoot(view, "right");
  await seedLifecycleTree(observer);
  // A second session of the same identity has its own database and no sharing
  // mutations. Its one folder create is outside the reconnect measurement.
  await generatePaneKeyPairFromMenu(peer);
  await restorePaneFromRecoveryKey(peer, await readPaneRecoveryKey(observer));
  await openExplorer(peer);
  await expectLifecycleNotes(peer);
  expect(getPaneUserId(peer)).toBe(getPaneUserId(observer));
  const observerSdk = sdks.get("left");
  const peerSdk = sdks.get("right");
  invariant(observerSdk && peerSdk, "Expected both pane SDKs");
  expect(observerSdk.session.authToken).not.toBe(peerSdk.session.authToken);
  await waitForLifecycleConnection(observerSdk, 1);
  await waitForLifecycleConnection(peerSdk, 1);
  expect(
    await observerSdk.containerContents.documentQueries().listPendingWrites(),
  ).toEqual([]);
  using sweep = observeReconnectSweep(observerSdk);
  await setLifecycleNetworkMode(observer, true);
  await waitFor(() => expect(observerSdk.events.connected).toBe(false));
  const createStart = listProxiedApiRequests().length;
  await createChildContainer(peer, "Created during disconnect");
  await waitFor(() => {
    expect(
      listProxiedApiRequests()
        .slice(createStart)
        .filter(
          (request) =>
            request.method === "POST" &&
            request.status === 200 &&
            requestPath(request.url) === "/containers/with-metadata-document",
        ),
    ).toHaveLength(1);
  });
  await waitForPaneRuntimeToSettle();
  expect(
    getExplorerSidebarItemsByName(observer, "Created during disconnect"),
  ).toHaveLength(0);

  const requests = await measureWorkflowRequests({
    label: "reconnect after peer folder create",
    budget: {
      total: 30,
      byRequest: {
        "POST /auth/ws-ticket": 1,
        "GET /organization-memberships": 1,
        "GET /organizations/:organizationId/billing": 0,
        "POST /containers/parent-lanes/query": 6,
        "POST /containers/documents/query": 2,
        "GET /principals/organization/:organizationId/policy": 5,
        "GET /principals/group/:groupId/policy": 0,
        "GET /principals/history": 0,
        "GET /containers/:containerId/writer-projection": 2,
        "GET /documents/:documentId/writer-projection": 4,
        "POST /documents/:documentId/sync": 9,
      },
    },
    mutations: [],
    operation: async () => {
      await setLifecycleNetworkMode(observer, false);
      await waitForLifecycleConnection(observerSdk, 2);
      await sweep.wait();
      expect(
        await observerSdk.containerContents
          .documentQueries()
          .listPendingWrites(),
      ).toEqual([]);
      await waitFor(() =>
        expect(
          getExplorerSidebarItem(observer, "Created during disconnect"),
        ).toBeTruthy(),
      );
    },
  });
  expectLifecycleReads(requests);
  await expectNoLateLifecycleRequests();
  // Count the whole window, but prove it contains only the observer's traffic.
  expect(
    requests.every(
      (request) =>
        request.authorization === `Bearer ${observerSdk.session.authToken}`,
    ),
  ).toBe(true);
  await unmountLifecyclePane({ view, pane: observer, sdk: () => observerSdk });
  expect(peerSdk.events.connected).toBe(false);
  await expectNoLateLifecycleRequests();
}, 60_000);
