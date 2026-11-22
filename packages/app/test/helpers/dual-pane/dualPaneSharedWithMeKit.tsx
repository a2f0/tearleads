import { fireEvent, screen, within } from "@testing-library/react";
import invariant from "invariant";
import { SHARED_WITH_ME_LABELS } from "../../../src/mini-apps/shared-with-me/labels";
import { waitForCondition } from "../waitForCondition";
import { interact } from "./dualPaneCore";

export async function openSharedWithMe(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, { clientX: 160, clientY: 160 });
  });
  await interact(() => {
    fireEvent.click(
      screen.getByRole("button", { name: SHARED_WITH_ME_LABELS.title }),
    );
  });
  await waitForCondition(
    () =>
      within(pane).queryByRole("table", {
        name: SHARED_WITH_ME_LABELS.title,
      }) !== null,
    "Shared with Me did not list the peer's own workspace.",
  );
}

function sharedWithMeRows(pane: HTMLElement): HTMLElement[] {
  const table = within(pane).getByRole("table", {
    name: SHARED_WITH_ME_LABELS.title,
  });
  return within(table)
    .queryAllByRole("row")
    .filter((row) => row.closest("tbody") !== null);
}

function cellText(row: HTMLElement, index: number): string {
  return row.querySelectorAll("td")[index]?.textContent ?? "";
}

/** The first column: the folder's name, or an organization row's name. */
export function rowName(row: HTMLElement | null): string | null {
  return row && cellText(row, 0);
}

/** Whether the row's status column carries `status`. */
export function rowShowsStatus(
  row: HTMLElement | null,
  status: string,
): boolean {
  return row !== null && cellText(row, 3).split(", ").includes(status);
}

/** The row for the pane's own workspace root. */
export function workspaceRootRow(pane: HTMLElement): HTMLElement | null {
  return (
    sharedWithMeRows(pane).find(
      (row) => rowName(row) === SHARED_WITH_ME_LABELS.workspaceRoot,
    ) ?? null
  );
}

/**
 * The founder's organization as a dual-pane peer sees it: the first row that
 * is not the peer's own workspace root. Both organizations use the default
 * profile name, so the workspace root tells them apart.
 */
export function memberOrganizationRow(pane: HTMLElement): HTMLElement | null {
  return (
    sharedWithMeRows(pane).find(
      (row) => rowName(row) !== SHARED_WITH_ME_LABELS.workspaceRoot,
    ) ?? null
  );
}

export function sharedWithMeShowsFolder(
  pane: HTMLElement,
  folderName: string,
): boolean {
  return sharedWithMeRows(pane).some((row) => rowName(row) === folderName);
}

/**
 * The open row menu's enabled item for `action` on the row's organization, or
 * null. The menu reads its row live, so an item appears once what it depends
 * on (a membership listing, a finished change) has settled.
 */
export function rowMenuItem(
  row: HTMLElement | null,
  action: (organizationName: string) => string,
): HTMLButtonElement | null {
  if (!row) return null;
  const item = screen.queryByRole("button", { name: action(cellText(row, 1)) });
  return item instanceof HTMLButtonElement && !item.disabled ? item : null;
}

export async function openRowMenu(row: HTMLElement | null) {
  invariant(row, "Expected a Shared with Me row");
  await interact(() => {
    fireEvent.contextMenu(row);
  });
}

export async function clickRowMenuItem(
  row: HTMLElement | null,
  action: (organizationName: string) => string,
) {
  const item = rowMenuItem(row, action);
  invariant(item, "Expected the row menu to offer the action");
  await interact(() => {
    fireEvent.click(item);
  });
}

/** Opens the row's menu and chooses `action` for its organization. */
export async function chooseRowAction(
  row: HTMLElement | null,
  action: (organizationName: string) => string,
) {
  await openRowMenu(row);
  await clickRowMenuItem(row, action);
}
