import { afterEach, expect, test } from "bun:test";
import { DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME } from "@tearleads/client-sdk";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
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
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { shareContainerWithPeer } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import { ORGANIZATIONS_LABELS } from "../../../mini-apps/organizations/labels";

const SHARED_FOLDER = "Team Folder";
const DASHBOARD_TIMEOUT_MS = 20_000;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

async function openOrganizationsDashboard(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, { clientX: 160, clientY: 160 });
  });
  await interact(() => {
    fireEvent.click(
      screen.getByRole("button", { name: ORGANIZATIONS_LABELS.title }),
    );
  });
  await waitForCondition(
    () =>
      within(pane).queryByRole("list", { name: ORGANIZATIONS_LABELS.title }) !==
      null,
    "Organizations dashboard did not list the peer's own organization.",
  );
}

// The founder's organization as the peer sees it: the only card the peer is a
// plain member of. Both organizations carry the default profile name, so the
// badge is what tells them apart.
function memberOrganizationCard(pane: HTMLElement): HTMLElement | null {
  const dashboard = within(pane).getByRole("list", {
    name: ORGANIZATIONS_LABELS.title,
  });
  return (
    within(dashboard)
      .queryAllByRole("region")
      .find(
        (card) =>
          within(card).queryByText(ORGANIZATIONS_LABELS.memberBadge) !== null,
      ) ?? null
  );
}

function explorerSectionHeadings(pane: HTMLElement): string[] {
  return Array.from(
    pane.querySelectorAll(".explorer-sidebar-section-label"),
  ).map((element) => element.textContent?.trim() ?? "");
}

test(
  "a Members-only peer discovers the organization and its shared folders",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const founderPane = getPaneRoot(view, "left");
    const peerPane = getPaneRoot(view, "right");
    await waitForDualPaneProvisioning(founderPane, peerPane);
    await waitForPersonalBootstrap(2);

    await openExplorer(peerPane);
    await openOrganizationsDashboard(peerPane);
    expect(memberOrganizationCard(peerPane)).toBeNull();

    // Roster import enrolls the peer in Members only: no Admins grant, so the
    // founder's root stays out of reach and the org is no workspace for it.
    await importPeerIntoRoster(founderPane, getPaneUserId(peerPane));
    await waitForCondition(
      () =>
        memberOrganizationCard(peerPane)?.querySelector("h3")?.textContent ===
        DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
      "The peer's dashboard did not surface the founder organization after the Members import.",
      DASHBOARD_TIMEOUT_MS,
    );
    const card = memberOrganizationCard(peerPane);
    expect(
      card && within(card).getByText(ORGANIZATIONS_LABELS.noFolders),
    ).toBeTruthy();

    await openExplorer(founderPane);
    await createChildContainer(founderPane, SHARED_FOLDER);
    await shareContainerWithPeer(founderPane, SHARED_FOLDER);

    // No refresh: the share's user-scoped hint re-lists the peer's containers.
    await waitForCondition(
      () => {
        const memberCard = memberOrganizationCard(peerPane);
        return (
          memberCard !== null &&
          within(memberCard).queryByRole("button", { name: SHARED_FOLDER }) !==
            null
        );
      },
      "The peer's dashboard did not list the folder shared from the founder organization.",
      DASHBOARD_TIMEOUT_MS,
    );
    // Explorer heads the shared folder with the organization's name rather
    // than the generic "Shared with me" bucket it used for rootless orgs.
    await waitForCondition(
      () =>
        explorerSectionHeadings(peerPane).includes(
          DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
        ),
      `Explorer did not name the founder organization's section (headings=${JSON.stringify(explorerSectionHeadings(peerPane))}).`,
      DASHBOARD_TIMEOUT_MS,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS * 2,
);
