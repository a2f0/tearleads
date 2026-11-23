import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OrganizationSyncChoices } from "../hooks/useOrganizationSyncChoices";
import { SHARED_WITH_ME_LABELS } from "../labels";
import type {
  SharedOrganization,
  SharedWithMeRow,
} from "../model/sharedWithMeRows";
import { SharedWithMeContextMenu } from "./SharedWithMeContextMenu";

afterEach(cleanup);

const acme: SharedOrganization = {
  canAskToLeave: true,
  leaveRequested: false,
  name: "Acme",
  organizationId: "acme",
  syncPaused: false,
};

function folderRow(organization: SharedOrganization): SharedWithMeRow {
  return {
    folder: {
      accessLevel: "write",
      id: "design",
      name: "Design",
      workspaceRoot: false,
    },
    key: "folder:design",
    kind: "folder",
    organization,
  };
}

function renderMenu(
  row: SharedWithMeRow,
  changingOrganizationId: string | null = null,
) {
  const onClose = mock(() => {});
  const onOpenFolder = mock((_folderId: string) => {});
  const setLeaveRequested = mock(
    async (_organizationId: string, _requested: boolean) => {},
  );
  const setSyncPaused = mock(
    async (_organizationId: string, _paused: boolean) => {},
  );
  const syncChoices: OrganizationSyncChoices = {
    changingOrganizationId,
    error: null,
    memberships: null,
    pausedOrganizationIds: new Set(),
    setLeaveRequested,
    setSyncPaused,
  };
  render(
    <SharedWithMeContextMenu
      onClose={onClose}
      onOpenFolder={onOpenFolder}
      position={{ x: 10, y: 10 }}
      row={row}
      syncChoices={syncChoices}
    />,
  );
  const labels = () =>
    screen.getAllByRole("button").map((button) => button.textContent);
  const item = (name: string) => {
    const button = screen.getByRole("button", { name });
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Expected a menu button named ${name}`);
    }
    return button;
  };
  return {
    item,
    labels,
    onClose,
    onOpenFolder,
    setLeaveRequested,
    setSyncPaused,
  };
}

test("lists the folder's open action, then its organization's choices", () => {
  const { labels } = renderMenu(folderRow(acme));

  expect(labels()).toEqual([
    SHARED_WITH_ME_LABELS.open,
    SHARED_WITH_ME_LABELS.pauseSync("Acme"),
    SHARED_WITH_ME_LABELS.askToLeave("Acme"),
  ]);
});

test("each action closes the menu and runs against the row", () => {
  const open = renderMenu(folderRow(acme));
  fireEvent.click(open.item(SHARED_WITH_ME_LABELS.open));
  expect(open.onOpenFolder.mock.calls).toEqual([["design"]]);
  expect(open.onClose).toHaveBeenCalledTimes(1);
  cleanup();

  const pause = renderMenu(folderRow(acme));
  fireEvent.click(pause.item(SHARED_WITH_ME_LABELS.pauseSync("Acme")));
  expect(pause.setSyncPaused.mock.calls).toEqual([["acme", true]]);
  expect(pause.onClose).toHaveBeenCalledTimes(1);
  cleanup();

  const leave = renderMenu(folderRow(acme));
  fireEvent.click(leave.item(SHARED_WITH_ME_LABELS.askToLeave("Acme")));
  expect(leave.setLeaveRequested.mock.calls).toEqual([["acme", true]]);
});

test("offers to undo the organization's current choices", () => {
  const { item, setLeaveRequested, setSyncPaused } = renderMenu(
    folderRow({ ...acme, leaveRequested: true, syncPaused: true }),
  );

  fireEvent.click(item(SHARED_WITH_ME_LABELS.resumeSync("Acme")));
  fireEvent.click(item(SHARED_WITH_ME_LABELS.withdrawLeaveRequest("Acme")));
  expect(setSyncPaused.mock.calls).toEqual([["acme", false]]);
  expect(setLeaveRequested.mock.calls).toEqual([["acme", false]]);
});

test("an organization row offers no open action, and a personal one no leave request", () => {
  const { labels } = renderMenu({
    key: "organization:personal",
    kind: "organization",
    organization: {
      ...acme,
      canAskToLeave: false,
      name: null,
      organizationId: "personal",
    },
  });

  expect(labels()).toEqual([
    SHARED_WITH_ME_LABELS.pauseSync(SHARED_WITH_ME_LABELS.unnamedOrganization),
  ]);
});

test("holds the organization's choices while any change runs, but still opens", () => {
  const { item } = renderMenu(folderRow(acme), "other");

  expect(item(SHARED_WITH_ME_LABELS.open).disabled).toBe(false);
  expect(item(SHARED_WITH_ME_LABELS.pauseSync("Acme")).disabled).toBe(true);
  expect(item(SHARED_WITH_ME_LABELS.askToLeave("Acme")).disabled).toBe(true);
});
