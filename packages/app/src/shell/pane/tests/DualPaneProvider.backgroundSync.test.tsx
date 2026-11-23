import { afterEach, expect, test } from "bun:test";
import type { ContainerContentsStore, Tearleads } from "@tearleads/client-sdk";
import { cleanup } from "@testing-library/react";
import { settleAppTestRuntimeInAct } from "../../../../test/helpers/appRuntimeIdle";
import { ContainerTreeProbe } from "../../../../test/helpers/dual-pane/ContainerTreeProbe";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  getPaneUserId,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  createNoteInContainer,
  openExplorer,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import {
  chooseRowAction,
  memberOrganizationRow,
  openSharedWithMe,
  rowShowsStatus,
  sharedWithMeShowsFolder,
} from "../../../../test/helpers/dual-pane/dualPaneSharedWithMeKit";
import { shareContainerWithPeer } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import { SHARED_WITH_ME_LABELS } from "../../../mini-apps/shared-with-me/labels";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { type PaneSide, usePaneSide } from "../dual-pane";

const SHARED_FOLDER = "Team Folder";
const SHARED_NOTE = "Team note";
const PAUSED_NOTE = "Paused note";
const SYNC_TIMEOUT_MS = 20_000;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

function SdkProbe({ sdks }: { sdks: Map<PaneSide, Tearleads> }) {
  sdks.set(usePaneSide(), useTearleads());
  return null;
}

interface PeerFolderDocument {
  readonly localId: string;
  readonly title: string;
}

/** The documents the peer's device holds in the shared folder, as stored. */
async function peerFolderDocuments(
  trees: ReadonlyMap<PaneSide, ContainerContentsStore>,
  sdks: ReadonlyMap<PaneSide, Tearleads>,
): Promise<PeerFolderDocument[]> {
  const containerId =
    trees
      .get("right")
      ?.getSnapshot()
      .nodes.find((node) => node.name === SHARED_FOLDER)?.id ?? null;
  const sdk = sdks.get("right");
  if (!containerId || !sdk) return [];
  const window = await sdk.containerContents
    .documentQueries()
    .listContainerDocumentSidebarWindow({ containerId, limit: 10, offset: 0 });
  return window.rows.map((row) => ({ localId: row.localId, title: row.title }));
}

function describeDocuments(documents: readonly PeerFolderDocument[]): string {
  return JSON.stringify(documents.map((document) => document.title));
}

async function settleSync(): Promise<boolean> {
  return settleAppTestRuntimeInAct({
    apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
    timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  });
}

test(
  "a peer that never opens Explorer pulls shared content in the background, except while paused",
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

    // The peer only ever opens Shared with Me; no Explorer window exists on
    // its side for the whole test.
    await openSharedWithMe(peerPane);
    await waitForCondition(
      () => sharedWithMeShowsFolder(peerPane, SHARED_FOLDER),
      "Shared with Me did not list the shared folder.",
      SYNC_TIMEOUT_MS,
    );
    let documents: PeerFolderDocument[] = [];
    await waitForCondition(
      async () => {
        documents = await peerFolderDocuments(trees, sdks);
        return documents.some((document) => document.title === SHARED_NOTE);
      },
      () =>
        `The peer did not pull the shared note's content without Explorer. documents=${describeDocuments(documents)}`,
      SYNC_TIMEOUT_MS,
    );

    await chooseRowAction(
      memberOrganizationRow(peerPane),
      SHARED_WITH_ME_LABELS.pauseSync,
    );
    await waitForCondition(
      () =>
        rowShowsStatus(
          memberOrganizationRow(peerPane),
          SHARED_WITH_ME_LABELS.syncPausedStatus,
        ),
      "The shared folder's organization did not show as paused.",
      SYNC_TIMEOUT_MS,
    );

    // Paused, the founder's new note reaches nothing on the peer's device.
    await createNoteInContainer(founderPane, SHARED_FOLDER, PAUSED_NOTE);
    expect(await settleSync()).toBe(true);
    documents = await peerFolderDocuments(trees, sdks);
    expect(documents.map((document) => document.title)).toEqual([SHARED_NOTE]);

    // Resuming catches up in the background, still without Explorer.
    await chooseRowAction(
      memberOrganizationRow(peerPane),
      SHARED_WITH_ME_LABELS.resumeSync,
    );
    await waitForCondition(
      async () => {
        documents = await peerFolderDocuments(trees, sdks);
        return documents.some((document) => document.title === PAUSED_NOTE);
      },
      () =>
        `Resuming did not pull the note added while paused. documents=${describeDocuments(documents)}`,
      SYNC_TIMEOUT_MS,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS * 2,
);
