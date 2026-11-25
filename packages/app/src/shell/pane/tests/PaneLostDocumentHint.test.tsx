import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { useEffect } from "react";
import {
  generatePaneKeyPairFromMenu,
  getPaneRoot,
  getPaneUserId,
  readPaneRecoveryKey,
  renderDualPane,
  restorePaneFromRecoveryKey,
  selectContainerAndWaitForItemTable,
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
  editLifecycleNote,
  expectLifecycleNotes,
  expectNoLateLifecycleRequests,
  lifecycleSyncRequestsBy,
  observeReconnectSweep,
  renderLifecyclePane,
  seedLifecycleTree,
  setLifecycleNetworkMode,
  unmountLifecyclePane,
  waitForLifecycleConnection,
  waitForLifecycleQuiet,
} from "../../../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  waitForPersistedPaneLocalIdentity,
} from "../../../../test/helpers/paneTestUtils";
import { createPersistedPaneStorage } from "../../../../test/helpers/persistedPaneStorage";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { type PaneSide, usePaneSide } from "../dual-pane";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

const FOLDER = "Canary A";
const NOTE = `Note in ${FOLDER}`;
const EDITED = "Edited while away";

function PeerSdkProbe({ sdks }: { sdks: Map<PaneSide, Tearleads> }) {
  const sdk = useTearleads();
  const side = usePaneSide();
  useEffect(() => {
    sdks.set(side, sdk);
  }, [sdks, side, sdk]);
  return null;
}

function remoteNoteId(sdk: Tearleads, title: string): string {
  const { documentSummariesByContainerId } = sdk.deviceFirst
    .open()
    .view.getSnapshot();
  const summary = [...documentSummariesByContainerId.values()]
    .flat()
    .find((document) => document.title === title);
  invariant(summary?.documentId, `Expected a synced note titled ${title}`);
  return summary.documentId;
}

/** The folder lists the note under its edited text, and not its old one. */
async function expectEditedNote(pane: HTMLElement) {
  const table = await selectContainerAndWaitForItemTable(pane, FOLDER);
  await within(table).findByRole(
    "button",
    { name: EDITED },
    { timeout: 20_000 },
  );
  expect(within(table).queryByRole("button", { name: NOTE })).toBeNull();
}

test("reconnect shows a note a peer edited while this session was disconnected", async () => {
  useTestApiAppHandlers();
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
  // The observer has listed its own creates, so only the peer's edit can
  // list the note again.
  await waitForLifecycleQuiet();

  const noteIds = {
    edited: remoteNoteId(observerSdk, NOTE),
    untouched: remoteNoteId(observerSdk, "Note in Canary B"),
  };

  using sweep = observeReconnectSweep(observerSdk);
  await setLifecycleNetworkMode(observer, true);
  await waitFor(() => expect(observerSdk.events.connected).toBe(false));
  await editLifecycleNote(peer, peerSdk, EDITED);
  await expectNoLateLifecycleRequests();

  const reconnected = listProxiedApiRequests().length;
  await setLifecycleNetworkMode(observer, false);
  await waitForLifecycleConnection(observerSdk, 2);
  await sweep.wait();
  await expectEditedNote(observer);
  // The listing that followed the acknowledgement owed the read: the note the
  // peer edited was synced, and the note nobody touched was not.
  await waitForLifecycleQuiet();
  const synced = lifecycleSyncRequestsBy(observerSdk, reconnected).map(
    (request) => requestPath(request.url),
  );
  expect(synced).toContain(`/documents/${noteIds.edited}/sync`);
  expect(synced).not.toContain(`/documents/${noteIds.untouched}/sync`);
  await unmountLifecyclePane({ view, pane: observer, sdk: () => observerSdk });
  await expectNoLateLifecycleRequests();
}, 120_000);

test("restart shows a note a peer edited while this session was closed", async () => {
  useTestApiAppHandlers();
  const storage = createPersistedPaneStorage();
  const namespace = `lost-document-hint-${crypto.randomUUID()}`;
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

  // Another device of the same identity edits the note while the first one
  // is closed, so no hint can reach it.
  const peer = renderLifecyclePane(
    createTestHostConfig({
      localIdentityNamespace: `lost-document-hint-peer-${crypto.randomUUID()}`,
    }),
  );
  await generatePaneKeyPairFromMenu(peer.pane);
  await restorePaneFromRecoveryKey(peer.pane, recoveryKey);
  await openExplorer(peer.pane);
  await expectLifecycleNotes(peer.pane);
  await editLifecycleNote(peer.pane, peer.sdk(), EDITED);
  await unmountLifecyclePane(peer);

  const restarted = renderLifecyclePane(hostConfig);
  await waitForSinglePaneProvisioning(restarted.pane);
  await waitForLifecycleConnection(restarted.sdk(), 1);
  await openExplorer(restarted.pane);
  await expectEditedNote(restarted.pane);
  await unmountLifecyclePane(restarted);
  await expectNoLateLifecycleRequests();
}, 120_000);
