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
  memberCardShowsFolder,
  memberOrganizationCard,
  openOrganizationsDashboard,
} from "../../../../test/helpers/dual-pane/dualPaneOrganizationsKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { shareContainerWithPeer } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import { ORGANIZATIONS_LABELS } from "../../../mini-apps/organizations/labels";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { type PaneSide, usePaneSide } from "../dual-pane";

const SHARED_FOLDER = "Team Folder";
const SHARED_NOTE = "Team note";
const SYNC_TIMEOUT_MS = 20_000;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

async function clickMemberCardButton(pane: HTMLElement, name: string) {
  const card = memberOrganizationCard(pane);
  if (!card) throw new Error("Expected the peer's member organization card");
  const button = within(card).getByRole("button", { name });
  await interact(() => {
    fireEvent.click(button);
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

/** The local id of a document the peer's device holds in the shared folder. */
async function peerFolderDocumentLocalId(
  trees: ReadonlyMap<PaneSide, ContainerContentsStore>,
  sdks: ReadonlyMap<PaneSide, Tearleads>,
): Promise<string | null> {
  const containerId = peerFolderId(trees, SHARED_FOLDER);
  const sdk = sdks.get("right");
  if (!containerId || !sdk) return null;
  const window = await sdk.containerContents
    .documentQueries()
    .listContainerDocumentSidebarWindow({ containerId, limit: 10, offset: 0 });
  return window.rows[0]?.localId ?? null;
}

async function peerHoldsFolderDocument(
  trees: ReadonlyMap<PaneSide, ContainerContentsStore>,
  sdks: ReadonlyMap<PaneSide, Tearleads>,
): Promise<boolean> {
  return (await peerFolderDocumentLocalId(trees, sdks)) !== null;
}

async function peerHoldsDocument(
  sdks: ReadonlyMap<PaneSide, Tearleads>,
  localId: string,
): Promise<boolean> {
  const summary = await sdks
    .get("right")
    ?.containerContents.documentQueries()
    .loadDocumentSummary(localId);
  return summary != null;
}

test(
  "pausing an organization removes its folders and documents until resumed",
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
    // The peer opens the folder, reconciling its documents before pausing, so
    // the resume below has to list them again rather than skip a known folder.
    await openExplorer(peerPane);
    await selectContainerAndWaitForItemTable(peerPane, SHARED_FOLDER);
    await waitForCondition(
      () => peerHoldsFolderDocument(trees, sdks),
      "The peer did not discover the shared folder's note.",
      SYNC_TIMEOUT_MS,
    );
    const noteLocalId = await peerFolderDocumentLocalId(trees, sdks);
    invariant(noteLocalId, "Expected the peer's copy of the note");
    // An editor holds the note open across the pause.
    await selectExplorerNoteByName(peerPane, SHARED_NOTE);

    await clickMemberCardButton(peerPane, ORGANIZATIONS_LABELS.pauseSync);
    await waitForCondition(
      () => peerFolderId(trees, SHARED_FOLDER) === null,
      "Pausing did not remove the shared folder from the peer's device.",
      SYNC_TIMEOUT_MS,
    );
    await waitForCondition(
      async () => !(await peerHoldsDocument(sdks, noteLocalId)),
      "Pausing did not remove the open note from the peer's device.",
      SYNC_TIMEOUT_MS,
    );
    // Runtime updates reach the open editor; none recreates the note.
    expect(
      await settleAppTestRuntimeInAct({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
      }),
    ).toBe(true);
    expect(await peerHoldsDocument(sdks, noteLocalId)).toBe(false);
    // The metadata root stays, so the organization keeps its card and name.
    const pausedCard = memberOrganizationCard(peerPane);
    expect(
      pausedCard &&
        within(pausedCard).getByText(ORGANIZATIONS_LABELS.syncPausedStatus),
    ).toBeTruthy();
    expect(
      pausedCard &&
        within(pausedCard).getByRole("button", {
          name: ORGANIZATIONS_LABELS.resumeSync,
        }),
    ).toBeTruthy();

    await clickMemberCardButton(peerPane, ORGANIZATIONS_LABELS.resumeSync);
    await waitForCondition(
      () => memberCardShowsFolder(peerPane, SHARED_FOLDER),
      "Resuming did not bring the shared folder back to the peer's dashboard.",
      SYNC_TIMEOUT_MS,
    );
    // Opening the folder again lists its documents afresh, even though it was
    // listed before the pause.
    await selectContainerAndWaitForItemTable(peerPane, SHARED_FOLDER);
    await waitForCondition(
      () => peerHoldsFolderDocument(trees, sdks),
      "Resuming did not bring the shared folder's note back to the peer.",
      SYNC_TIMEOUT_MS,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS * 2,
);
