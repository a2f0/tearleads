import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { waitFor } from "@testing-library/react";
import invariant from "invariant";
import { useEffect } from "react";
import {
  generatePaneKeyPairFromMenu,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  getPaneUserId,
  readPaneRecoveryKey,
  renderDualPane,
  restorePaneFromRecoveryKey,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { requestPath } from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  expectLifecycleNotes,
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
  createTestHostConfig,
  waitForPaneRuntimeToSettle,
  waitForPersistedPaneLocalIdentity,
} from "../../../../test/helpers/paneTestUtils";
import { createPersistedPaneStorage } from "../../../../test/helpers/persistedPaneStorage";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { type PaneSide, usePaneSide } from "../dual-pane";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

function PeerSdkProbe({ sdks }: { sdks: Map<PaneSide, Tearleads> }) {
  const sdk = useTearleads();
  const side = usePaneSide();
  useEffect(() => {
    sdks.set(side, sdk);
  }, [sdks, side, sdk]);
  return null;
}

/** Two sessions of one identity, each with its own database and socket. */
async function renderSameIdentityPanes() {
  const sdks = new Map<PaneSide, Tearleads>();
  const view = renderDualPane({
    autoProvisionRight: false,
    children: <PeerSdkProbe sdks={sdks} />,
  });
  const observer = getPaneRoot(view, "left");
  const peer = getPaneRoot(view, "right");
  await seedLifecycleTree(observer);
  await generatePaneKeyPairFromMenu(peer);
  await restorePaneFromRecoveryKey(peer, await readPaneRecoveryKey(observer));
  await openExplorer(peer);
  await expectLifecycleNotes(peer);
  expect(getPaneUserId(peer)).toBe(getPaneUserId(observer));
  const observerSdk = sdks.get("left");
  const peerSdk = sdks.get("right");
  invariant(observerSdk && peerSdk, "Expected both pane SDKs");
  await waitForLifecycleConnection(observerSdk, 1);
  await waitForLifecycleConnection(peerSdk, 1);
  return { observer, observerSdk, peer, peerSdk, view };
}

/** The peer renames a folder and waits until the server accepted the edit. */
async function renameOnPeer(peerSdk: Tearleads, from: string, to: string) {
  const tree = peerSdk.containerContents.openTree();
  const node = tree.getSnapshot().nodes.find(({ name }) => name === from);
  invariant(node, `Expected the peer to hold ${from}`);
  const start = listProxiedApiRequests().length;
  expect(await tree.renameContainer(node.id, to)).not.toBeNull();
  await waitFor(() => {
    expect(
      listProxiedApiRequests()
        .slice(start)
        .some(
          (request) =>
            request.method === "POST" &&
            request.status === 200 &&
            request.authorization === `Bearer ${peerSdk.session.authToken}` &&
            requestPath(request.url) === `/documents/${node.id}/sync`,
        ),
    ).toBe(true);
  });
  await waitForPaneRuntimeToSettle();
}

test("reconnect shows a folder a peer renamed while this session was disconnected", async () => {
  useTestApiAppHandlers();
  const { observer, observerSdk, peerSdk, view } =
    await renderSameIdentityPanes();
  using sweep = observeReconnectSweep(observerSdk);
  await setLifecycleNetworkMode(observer, true);
  await waitFor(() => expect(observerSdk.events.connected).toBe(false));
  await renameOnPeer(peerSdk, "Canary A", "Renamed while away");
  await expectNoLateLifecycleRequests();
  expect(getExplorerSidebarItemsByName(observer, "Canary A")).toHaveLength(1);

  await setLifecycleNetworkMode(observer, false);
  await waitForLifecycleConnection(observerSdk, 2);
  await sweep.wait();
  await expectRenamedFolder(observer);
  await unmountLifecyclePane({ view, pane: observer, sdk: () => observerSdk });
  await expectNoLateLifecycleRequests();
}, 90_000);

/** The renamed folder, and not its old name, is in this pane's sidebar. */
async function expectRenamedFolder(pane: HTMLElement) {
  await waitFor(
    () => {
      expect(
        getExplorerSidebarItemsByName(pane, "Renamed while away"),
      ).toHaveLength(1);
      expect(getExplorerSidebarItemsByName(pane, "Canary A")).toHaveLength(0);
    },
    { timeout: 10_000 },
  );
}

test("restart shows a folder a peer renamed while this session was closed", async () => {
  useTestApiAppHandlers();
  const storage = createPersistedPaneStorage();
  const namespace = `lost-metadata-hint-${crypto.randomUUID()}`;
  const hostConfig = createTestHostConfig({
    autoProvisionIdentity: true,
    localIdentityNamespace: namespace,
  }).withOverrides({ createSQLiteRuntime: storage.createRuntime });
  const first = renderLifecyclePane(hostConfig);
  await seedLifecycleTree(first.pane);
  await waitForLifecycleConnection(first.sdk(), 1);
  await waitForPersistedPaneLocalIdentity(namespace);
  const recoveryKey = await readPaneRecoveryKey(first.pane);
  await unmountLifecyclePane(first);

  // Another device of the same identity renames the folder while the first
  // one is closed, so no hint can reach it.
  const peer = renderLifecyclePane(
    createTestHostConfig({
      localIdentityNamespace: `lost-metadata-hint-peer-${crypto.randomUUID()}`,
    }),
  );
  await generatePaneKeyPairFromMenu(peer.pane);
  await restorePaneFromRecoveryKey(peer.pane, recoveryKey);
  await openExplorer(peer.pane);
  await expectLifecycleNotes(peer.pane);
  await renameOnPeer(peer.sdk(), "Canary A", "Renamed while away");
  await unmountLifecyclePane(peer);

  const restarted = renderLifecyclePane(hostConfig);
  await waitForSinglePaneProvisioning(restarted.pane);
  await waitForLifecycleConnection(restarted.sdk(), 1);
  await openExplorer(restarted.pane);
  await expectRenamedFolder(restarted.pane);
  await unmountLifecyclePane(restarted);
  await expectNoLateLifecycleRequests();
}, 120_000);
