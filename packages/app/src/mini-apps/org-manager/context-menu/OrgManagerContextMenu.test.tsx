import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  OrgManagerContextMenuLayer,
  type OrgManagerContextMenuState,
} from "./OrgManagerContextMenu";

afterEach(() => cleanup());

function ContextMenuLayerHarness(params: {
  canEditContextMenuRosterUser?: boolean | undefined;
  canCreateGroup?: boolean | undefined;
  canImportRosterUser?: boolean | undefined;
  contextMenu: OrgManagerContextMenuState;
  importRosterUserIntoContacts?: ((userId: string) => void) | undefined;
  openCreateGroupDialog?: (() => void) | undefined;
  openImportUserDialog?: (() => void) | undefined;
  openRosterUser?: ((userId: string) => void) | undefined;
  openRosterUserForEditing?: ((userId: string) => void) | undefined;
}) {
  const [contextMenu, setContextMenu] =
    useState<OrgManagerContextMenuState | null>(params.contextMenu);

  return (
    <OrgManagerContextMenuLayer
      canCreateGroup={params.canCreateGroup ?? true}
      canEditContextMenuRosterUser={params.canEditContextMenuRosterUser ?? true}
      canImportRosterUser={params.canImportRosterUser ?? true}
      closeContextMenu={() => setContextMenu(null)}
      contextMenu={contextMenu}
      importRosterUserIntoContacts={
        params.importRosterUserIntoContacts ?? (() => undefined)
      }
      loading={false}
      mutating={false}
      openCreateGroupDialog={params.openCreateGroupDialog ?? (() => undefined)}
      openImportUserDialog={params.openImportUserDialog ?? (() => undefined)}
      openRosterUser={params.openRosterUser ?? (() => undefined)}
      openRosterUserForEditing={
        params.openRosterUserForEditing ?? (() => undefined)
      }
    />
  );
}

test("org manager roster context menu opens import user", () => {
  let importCount = 0;
  const view = render(
    <ContextMenuLayerHarness
      contextMenu={{
        id: "directory",
        position: { x: 12, y: 34 },
      }}
      openImportUserDialog={() => {
        importCount += 1;
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.importUserAction }),
  );

  expect(importCount).toBe(1);
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.importUserAction }),
  ).toBeNull();
});

test("org manager groups context menu opens new group dialog", () => {
  let createCount = 0;
  const view = render(
    <ContextMenuLayerHarness
      contextMenu={{
        id: "groups",
        position: { x: 12, y: 34 },
      }}
      openCreateGroupDialog={() => {
        createCount += 1;
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
  );

  expect(createCount).toBe(1);
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
  ).toBeNull();
});

test("org manager roster row context menu opens, edits, and imports users", () => {
  const openedUserIds: string[] = [];
  const editedUserIds: string[] = [];
  const importedUserIds: string[] = [];
  const contextMenu = {
    id: { kind: "directory-user", userId: "user-1" },
    position: { x: 12, y: 34 },
  } satisfies OrgManagerContextMenuState;
  const view = render(
    <ContextMenuLayerHarness
      contextMenu={contextMenu}
      importRosterUserIntoContacts={(userId) => {
        importedUserIds.push(userId);
      }}
      openRosterUser={(userId) => {
        openedUserIds.push(userId);
      }}
      openRosterUserForEditing={(userId) => {
        editedUserIds.push(userId);
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.openRosterEntryAction,
    }),
  );
  expect(openedUserIds).toEqual(["user-1"]);

  view.rerender(
    <ContextMenuLayerHarness
      key="edit"
      contextMenu={contextMenu}
      importRosterUserIntoContacts={(userId) => {
        importedUserIds.push(userId);
      }}
      openRosterUser={(userId) => {
        openedUserIds.push(userId);
      }}
      openRosterUserForEditing={(userId) => {
        editedUserIds.push(userId);
      }}
    />,
  );
  fireEvent.click(
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.editRosterEntryAction,
    }),
  );
  expect(editedUserIds).toEqual(["user-1"]);

  view.rerender(
    <ContextMenuLayerHarness
      key="import"
      contextMenu={contextMenu}
      importRosterUserIntoContacts={(userId) => {
        importedUserIds.push(userId);
      }}
      openRosterUser={(userId) => {
        openedUserIds.push(userId);
      }}
      openRosterUserForEditing={(userId) => {
        editedUserIds.push(userId);
      }}
    />,
  );
  fireEvent.click(
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.importRosterEntryIntoContactsAction,
    }),
  );

  expect(importedUserIds).toEqual(["user-1"]);
});
