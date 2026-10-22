import { afterEach, expect, test } from "bun:test";
import type { ContainerContentsStore } from "@tearleads/client-sdk";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { ContainerTreeProbe } from "../../../../test/helpers/dual-pane/ContainerTreeProbe";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  openExplorer,
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
import type { PaneSide } from "../dual-pane";

const SHARED_FOLDER = "Team Folder";
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

function peerHoldsFolder(
  trees: ReadonlyMap<PaneSide, ContainerContentsStore>,
  name: string,
): boolean {
  return (
    trees
      .get("right")
      ?.getSnapshot()
      .nodes.some((node) => node.name === name) ?? false
  );
}

test(
  "pausing an organization removes its folders from the device until resumed",
  async () => {
    useTestApiAppHandlers();
    const trees = new Map<PaneSide, ContainerContentsStore>();
    const view = renderDualPane({
      children: <ContainerTreeProbe trees={trees} />,
    });
    const founderPane = getPaneRoot(view, "left");
    const peerPane = getPaneRoot(view, "right");
    await waitForDualPaneProvisioning(founderPane, peerPane);
    await waitForPersonalBootstrap(2);

    await importPeerIntoRoster(founderPane, getPaneUserId(peerPane));
    await openExplorer(founderPane);
    await createChildContainer(founderPane, SHARED_FOLDER);
    await shareContainerWithPeer(founderPane, SHARED_FOLDER);
    await openOrganizationsDashboard(peerPane);
    await waitForCondition(
      () => memberCardShowsFolder(peerPane, SHARED_FOLDER),
      "The peer's dashboard did not list the shared folder.",
      SYNC_TIMEOUT_MS,
    );

    await clickMemberCardButton(peerPane, ORGANIZATIONS_LABELS.pauseSync);
    await waitForCondition(
      () => !peerHoldsFolder(trees, SHARED_FOLDER),
      "Pausing did not remove the shared folder from the peer's device.",
      SYNC_TIMEOUT_MS,
    );
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
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS * 2,
);
