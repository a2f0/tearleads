import { afterEach, test } from "bun:test";
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
  openExplorer,
  refreshUntil,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  memberOrganizationCard,
  openOrganizationsDashboard,
} from "../../../../test/helpers/dual-pane/dualPaneOrganizationsKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import { ORG_MANAGER_LABELS } from "../../../mini-apps/org-manager/labels";
import { ORGANIZATIONS_LABELS } from "../../../mini-apps/organizations/labels";

const SYNC_TIMEOUT_MS = 20_000;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

function memberCardButton(pane: HTMLElement, name: string): HTMLElement | null {
  const card = memberOrganizationCard(pane);
  return card && within(card).queryByRole("button", { name });
}

/** The founder's roster row showing `status`. */
function rosterRowWithStatus(
  pane: HTMLElement,
  status: string,
): HTMLElement | null {
  const roster = within(pane).queryByRole("region", {
    name: ORG_MANAGER_LABELS.directory,
  });
  return (
    (roster &&
      within(roster)
        .queryAllByRole("row")
        .find((row) => within(row).queryByText(status) !== null)) ??
    null
  );
}

function rosterRowAskingToLeave(pane: HTMLElement): HTMLElement | null {
  return rosterRowWithStatus(pane, ORG_MANAGER_LABELS.leaveRequested);
}

test(
  "a member's request to leave reaches the founder, who approves it",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const founderPane = getPaneRoot(view, "left");
    const peerPane = getPaneRoot(view, "right");
    await waitForDualPaneProvisioning(founderPane, peerPane);
    await waitForPersonalBootstrap(2);

    await importPeerIntoRoster(founderPane, getPaneUserId(peerPane));
    await openOrganizationsDashboard(peerPane);
    await waitForCondition(
      () =>
        memberCardButton(peerPane, ORGANIZATIONS_LABELS.askToLeave) !== null,
      "The peer's dashboard did not offer to leave the founder's organization.",
      SYNC_TIMEOUT_MS,
    );

    await interact(() => {
      const button = memberCardButton(
        peerPane,
        ORGANIZATIONS_LABELS.askToLeave,
      );
      if (!button) throw new Error("Expected the Ask to leave button");
      fireEvent.click(button);
    });
    await waitForCondition(
      () =>
        memberCardButton(
          peerPane,
          ORGANIZATIONS_LABELS.withdrawLeaveRequest,
        ) !== null,
      "The peer's leave request was not filed.",
      SYNC_TIMEOUT_MS,
    );

    // The signed request reaches the founder's roster through the directory
    // lane, verified against the peer's signing key. Importing the peer left
    // its detail open, so return to the roster list first.
    await interact(() => {
      fireEvent.click(
        within(founderPane).getByRole("button", {
          name: ORG_MANAGER_LABELS.directory,
        }),
      );
    });
    const back = within(founderPane).queryByRole("button", {
      name: ORG_MANAGER_LABELS.back,
    });
    if (back) {
      await interact(() => {
        fireEvent.click(back);
      });
    }
    await waitForCondition(
      () => rosterRowAskingToLeave(founderPane) !== null,
      "The founder's roster did not show the peer asking to leave.",
      SYNC_TIMEOUT_MS,
    );
    await interact(() => {
      const row = rosterRowAskingToLeave(founderPane);
      if (!row) throw new Error("Expected the peer's roster row");
      fireEvent.contextMenu(row, { clientX: 200, clientY: 200 });
    });
    await interact(() => {
      fireEvent.click(
        screen.getByRole("button", {
          name: ORG_MANAGER_LABELS.approveLeaveRequestAction,
        }),
      );
    });

    // Approval is the ordinary signed removal, so the peer loses the
    // organization's metadata root and with it the organization.
    await waitForCondition(
      () =>
        rosterRowWithStatus(founderPane, ORG_MANAGER_LABELS.disabled) !== null,
      "The founder's roster did not show the peer removed.",
      SYNC_TIMEOUT_MS,
    );
    // A removed member gets no hint for what it lost; refreshing lists the
    // revocation.
    await openExplorer(peerPane);
    await refreshUntil(
      peerPane,
      () => memberOrganizationCard(peerPane) === null,
      "The approved leave request did not remove the organization from the peer.",
      SYNC_TIMEOUT_MS,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS * 2,
);
