import { fireEvent, screen, within } from "@testing-library/react";
import { ORGANIZATIONS_LABELS } from "../../../src/mini-apps/organizations/labels";
import { waitForCondition } from "../waitForCondition";
import { interact } from "./dualPaneCore";

export async function openOrganizationsDashboard(pane: HTMLElement) {
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

/**
 * The founder's organization as a dual-pane peer sees it: the one card that is
 * neither the active workspace nor carries the workspace badge. Both
 * organizations use the default profile name, so the badge tells them apart.
 */
export function memberOrganizationCard(pane: HTMLElement): HTMLElement | null {
  const dashboard = within(pane).getByRole("list", {
    name: ORGANIZATIONS_LABELS.title,
  });
  return (
    within(dashboard)
      .queryAllByRole("region")
      .find(
        (card) =>
          within(card).queryByText(ORGANIZATIONS_LABELS.memberBadge) !== null ||
          within(card).queryByText(ORGANIZATIONS_LABELS.syncPausedBadge) !==
            null,
      ) ?? null
  );
}

export function memberCardShowsFolder(
  pane: HTMLElement,
  folderName: string,
): boolean {
  const card = memberOrganizationCard(pane);
  return (
    card !== null &&
    within(card).queryByRole("button", { name: folderName }) !== null
  );
}
