import { afterEach, expect, test } from "bun:test";
import type { ContainerContentsStore, Tearleads } from "@tearleads/client-sdk";
import { cleanup, fireEvent, within } from "@testing-library/react";
import invariant from "invariant";
import { settleAppTestRuntimeInAct } from "../../../../test/helpers/appRuntimeIdle";
import { ContainerTreeProbe } from "../../../../test/helpers/dual-pane/ContainerTreeProbe";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  getPaneUserId,
  interact,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  renderDualPane,
  selectContainerAndWaitForItemTable,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  createNoteInContainer,
  openExplorer,
  selectExplorerNoteByName,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  activeOrganizationCard,
  memberCardShowsFolder,
  memberOrganizationCard,
  openOrganizationsDashboard,
} from "../../../../test/helpers/dual-pane/dualPaneOrganizationsKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { shareContainerWithPeer } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import { ORGANIZATIONS_LABELS } from "../../../mini-apps/organizations/labels";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { type PaneSide, usePaneSide } from "../dual-pane";

const SHARED_FOLDER = "Team Folder";
const SHARED_NOTE = "Team note";
const LATER_NOTE = "Later note";
const HELD_FOLDER = "Held folder";
const SYNC_TIMEOUT_MS = 20_000;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

async function clickCardButton(card: HTMLElement | null, name: string) {
  invariant(card, "Expected the organization's card");
  const button = within(card).getByRole("button", { name });
  await interact(() => {
    fireEvent.click(button);
  });
}

function cardShowsPaused(card: HTMLElement | null): boolean {
  return (
    card !== null &&
    within(card).queryByText(ORGANIZATIONS_LABELS.syncPausedStatus) !== null &&
    within(card).queryByRole("button", {
      name: ORGANIZATIONS_LABELS.resumeSync,
    }) !== null
  );
}

async function settleSync(): Promise<boolean> {
  return settleAppTestRuntimeInAct({
    apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
    timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  });
}

function SdkProbe({ sdks }: { sdks: Map<PaneSide, Tearleads> }) {
  sdks.set(usePaneSide(), useTearleads());
  return null;
}

function peerFolderId(
  trees: ReadonlyMap<PaneSide, ContainerContentsStore>,
  name: string,
): string | null {
  return (
    trees
      .get("right")
      ?.getSnapshot()
      .nodes.find((node) => node.name === name)?.id ?? null
  );
}

/** The local ids of the documents the peer's device holds in the folder. */
async function peerFolderDocumentLocalIds(
  trees: ReadonlyMap<PaneSide, ContainerContentsStore>,
  sdks: ReadonlyMap<PaneSide, Tearleads>,
): Promise<string[]> {
  const containerId = peerFolderId(trees, SHARED_FOLDER);
  const sdk = sdks.get("right");
  if (!containerId || !sdk) return [];
  const window = await sdk.containerContents
    .documentQueries()
    .listContainerDocumentSidebarWindow({ containerId, limit: 10, offset: 0 });
  return window.rows.map((row) => row.localId);
}

async function pendingWriteCount(sdk: Tearleads | undefined): Promise<number> {
  invariant(sdk, "Expected the pane's SDK");
  return (await sdk.containerContents.documentQueries().listPendingWrites())
    .length;
}

test(
  "pausing a shared organization keeps its copy and holds new content until resumed",
  async () => {
    useTestApiAppHandlers();
    const trees = new Map<PaneSide, ContainerContentsStore>();
    const sdks = new Map<PaneSide, Tearleads>();
    const view = renderDualPane({
      children: (
        <>
          <ContainerTreeProbe trees={trees} />
          <SdkProbe sdks={sdks} />
        </>
      ),
    });
    const founderPane = getPaneRoot(view, "left");
    const peerPane = getPaneRoot(view, "right");
    await waitForDualPaneProvisioning(founderPane, peerPane);
    await waitForPersonalBootstrap(2);

    await importPeerIntoRoster(founderPane, getPaneUserId(peerPane));
    await openExplorer(founderPane);
    await createChildContainer(founderPane, SHARED_FOLDER);
    await createNoteInContainer(founderPane, SHARED_FOLDER, SHARED_NOTE);
    await shareContainerWithPeer(founderPane, SHARED_FOLDER);
    await openOrganizationsDashboard(peerPane);
    await waitForCondition(
      () => memberCardShowsFolder(peerPane, SHARED_FOLDER),
      "The peer's dashboard did not list the shared folder.",
      SYNC_TIMEOUT_MS,
    );
    // The peer opens the folder, reconciling its documents before pausing.
    await openExplorer(peerPane);
    await selectContainerAndWaitForItemTable(peerPane, SHARED_FOLDER);
    await waitForCondition(
      async () => (await peerFolderDocumentLocalIds(trees, sdks)).length === 1,
      "The peer did not discover the shared folder's note.",
      SYNC_TIMEOUT_MS,
    );
    // An editor holds the note open across the pause.
    await selectExplorerNoteByName(peerPane, SHARED_NOTE);

    await clickCardButton(
      memberOrganizationCard(peerPane),
      ORGANIZATIONS_LABELS.pauseSync,
    );
    await waitForCondition(
      () => cardShowsPaused(memberOrganizationCard(peerPane)),
      "The peer's card did not show the organization as paused.",
      SYNC_TIMEOUT_MS,
    );

    // The founder adds a note while the peer is paused. Once everything has
    // settled, the peer still holds exactly what it had: the folder, its one
    // note, and nothing new.
    await createNoteInContainer(founderPane, SHARED_FOLDER, LATER_NOTE);
    expect(await settleSync()).toBe(true);
    expect(memberCardShowsFolder(peerPane, SHARED_FOLDER)).toBe(true);
    expect(await peerFolderDocumentLocalIds(trees, sdks)).toHaveLength(1);

    await clickCardButton(
      memberOrganizationCard(peerPane),
      ORGANIZATIONS_LABELS.resumeSync,
    );
    await waitForCondition(
      async () => (await peerFolderDocumentLocalIds(trees, sdks)).length === 2,
      "Resuming did not bring the note added during the pause to the peer.",
      SYNC_TIMEOUT_MS,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS * 2,
);

test(
  "pausing your own organization holds your changes on the device until resumed",
  async () => {
    useTestApiAppHandlers();
    const trees = new Map<PaneSide, ContainerContentsStore>();
    const sdks = new Map<PaneSide, Tearleads>();
    const view = renderDualPane({
      children: (
        <>
          <ContainerTreeProbe trees={trees} />
          <SdkProbe sdks={sdks} />
        </>
      ),
    });
    const pane = getPaneRoot(view, "left");
    await waitForDualPaneProvisioning(pane, getPaneRoot(view, "right"));
    await waitForPersonalBootstrap(2);
    await openOrganizationsDashboard(pane);
    expect(await settleSync()).toBe(true);
    const sdk = sdks.get("left");
    const tree = trees.get("left");
    invariant(sdk && tree, "Expected the pane's SDK and container tree");
    expect(await pendingWriteCount(sdk)).toBe(0);

    // The personal organization is the one the session is working in.
    await clickCardButton(
      activeOrganizationCard(pane),
      ORGANIZATIONS_LABELS.pauseSync,
    );
    await waitForCondition(
      () => cardShowsPaused(activeOrganizationCard(pane)),
      "The card did not show the personal organization as paused.",
      SYNC_TIMEOUT_MS,
    );

    const rootId = sdk.runtime.input().state.containerId;
    invariant(rootId, "Expected the session's root container");
    await interact(async () => {
      await tree.createChild(rootId, HELD_FOLDER);
    });
    await waitForCondition(
      async () => (await pendingWriteCount(sdk)) > 0,
      "The new folder never reached the write queue.",
      SYNC_TIMEOUT_MS,
    );
    // Paused, the change stays queued on the device however long sync idles.
    expect(await settleSync()).toBe(true);
    expect(await pendingWriteCount(sdk)).toBeGreaterThan(0);

    await clickCardButton(
      activeOrganizationCard(pane),
      ORGANIZATIONS_LABELS.resumeSync,
    );
    await waitForCondition(
      async () => (await pendingWriteCount(sdk)) === 0,
      "Resuming did not upload the change made while paused.",
      SYNC_TIMEOUT_MS,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS * 2,
);
