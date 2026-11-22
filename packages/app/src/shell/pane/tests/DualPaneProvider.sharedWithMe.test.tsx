import { afterEach, expect, test } from "bun:test";
import { DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME } from "@tearleads/client-sdk";
import { cleanup } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  getPaneUserId,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  openExplorer,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import {
  memberOrganizationRow,
  openSharedWithMe,
  rowName,
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

const SHARED_FOLDER = "Team Folder";
const LIST_TIMEOUT_MS = 20_000;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

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
    await openSharedWithMe(peerPane);
    expect(memberOrganizationRow(peerPane)).toBeNull();

    // Roster import enrolls the peer in Members only: no Admins grant, so the
    // founder's root stays out of reach and the org is no workspace for it.
    await importPeerIntoRoster(founderPane, getPaneUserId(peerPane));
    // Nothing is shared yet, so the organization gets a row of its own.
    await waitForCondition(
      () =>
        rowName(memberOrganizationRow(peerPane)) ===
        DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
      "Shared with Me did not surface the founder organization after the Members import.",
      LIST_TIMEOUT_MS,
    );
    expect(
      rowShowsStatus(
        memberOrganizationRow(peerPane),
        SHARED_WITH_ME_LABELS.nothingSharedStatus,
      ),
    ).toBe(true);

    await openExplorer(founderPane);
    await createChildContainer(founderPane, SHARED_FOLDER);
    await shareContainerWithPeer(founderPane, SHARED_FOLDER);

    // No refresh: the share's user-scoped hint re-lists the peer's containers.
    await waitForCondition(
      () => sharedWithMeShowsFolder(peerPane, SHARED_FOLDER),
      "Shared with Me did not list the folder shared from the founder organization.",
      LIST_TIMEOUT_MS,
    );
    // Explorer heads the shared folder with the organization's name rather
    // than the generic "Shared with me" bucket it used for rootless orgs.
    await waitForCondition(
      () =>
        explorerSectionHeadings(peerPane).includes(
          DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
        ),
      `Explorer did not name the founder organization's section (headings=${JSON.stringify(explorerSectionHeadings(peerPane))}).`,
      LIST_TIMEOUT_MS,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS * 2,
);
