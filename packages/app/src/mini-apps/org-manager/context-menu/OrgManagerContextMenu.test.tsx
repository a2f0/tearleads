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
  canCreateGroup?: boolean | undefined;
  canImportRosterUser?: boolean | undefined;
  contextMenu: OrgManagerContextMenuState;
  openCreateGroupDialog?: (() => void) | undefined;
  openImportUserDialog?: (() => void) | undefined;
}) {
  const [contextMenu, setContextMenu] =
    useState<OrgManagerContextMenuState | null>(params.contextMenu);

  return (
    <OrgManagerContextMenuLayer
      canCreateGroup={params.canCreateGroup ?? true}
      canImportRosterUser={params.canImportRosterUser ?? true}
      closeContextMenu={() => setContextMenu(null)}
      contextMenu={contextMenu}
      loading={false}
      mutating={false}
      openCreateGroupDialog={params.openCreateGroupDialog ?? (() => undefined)}
      openImportUserDialog={params.openImportUserDialog ?? (() => undefined)}
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
