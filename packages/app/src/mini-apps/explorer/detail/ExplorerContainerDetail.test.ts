import { afterEach, expect, test } from "bun:test";
import {
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { EXPLORER_LABELS } from "../labels";
import { getNextExplorerItemSort } from "./ExplorerContainerDetail";
import { ExplorerContainerItemTable } from "./ExplorerContainerItemTable";
import type { ExplorerItemColumnId } from "./explorerItemColumnIds";

afterEach(() => cleanup());

const selectedNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "Root",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

const archiveRow: ContainerItemRow = {
  createdAt: null,
  id: "archive-container",
  itemKind: "container",
  name: "Archive",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

const noteRow: ContainerItemRow = {
  containerId: "root-container",
  createdAt: null,
  documentId: "note-doc",
  documentKind: "note",
  itemKind: "document",
  localId: "note-local",
  name: "Note",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

const currentSelfContactRow: ContainerItemRow = {
  containerId: "contacts-container",
  createdAt: null,
  documentId: "current-self-contact-doc",
  documentKind: "contact",
  itemKind: "document",
  localId: "self_contact_v1_current-fingerprint",
  name: "current-user-id",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

const ownerSelfContactRow: ContainerItemRow = {
  containerId: "shared-contacts-container",
  createdAt: null,
  documentId: "owner-self-contact-doc",
  documentKind: "contact",
  itemKind: "document",
  localId: "self_contact_v1_owner-fingerprint",
  name: "owner-user-id",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

const namedCurrentSelfContactRow: ContainerItemRow = {
  containerId: "contacts-container",
  createdAt: null,
  documentId: "named-current-self-contact-doc",
  documentKind: "contact",
  itemKind: "document",
  localId: "current-user-id",
  name: "Local Admin",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

type ExplorerContainerItemTableProps = ComponentProps<
  typeof ExplorerContainerItemTable
>;

function renderContainerItemTable(
  overrides: Partial<ExplorerContainerItemTableProps>,
) {
  return render(
    createElement(ExplorerContainerItemTable, {
      contextTarget: null,
      currentSigningFingerprint: null,
      currentUserId: null,
      dragActive: false,
      error: null,
      frameRef: () => undefined,
      handleDragEnter: () => undefined,
      handleDragLeave: () => undefined,
      handleDragOver: () => undefined,
      handleDrop: () => undefined,
      hiddenColumns: new Set<ExplorerItemColumnId>(),
      isImporting: false,
      isLoading: false,
      online: true,
      onBlankContextMenu: () => undefined,
      onItemContextMenu: () => undefined,
      onSort: () => undefined,
      rows: [],
      rowOffset: 0,
      selectedNode,
      selectDocumentProjection: () => undefined,
      setSelectedId: () => undefined,
      sort: { direction: "asc", key: "name" },
      toggleColumn: () => undefined,
      totalCount: 0,
      ...overrides,
    }),
  );
}

test("container item sort toggles the active column and initializes new columns", () => {
  expect(
    getNextExplorerItemSort({ direction: "asc", key: "name" }, "name"),
  ).toEqual({
    direction: "desc",
    key: "name",
  });

  expect(
    getNextExplorerItemSort({ direction: "desc", key: "modified" }, "name"),
  ).toEqual({
    direction: "asc",
    key: "name",
  });

  expect(
    getNextExplorerItemSort({ direction: "desc", key: "name" }, "type"),
  ).toEqual({
    direction: "asc",
    key: "type",
  });

  expect(
    getNextExplorerItemSort({ direction: "asc", key: "name" }, "modified"),
  ).toEqual({
    direction: "desc",
    key: "modified",
  });
});

test("container item table opens the selected container context menu from blank space", () => {
  const containerIds: string[] = [];
  const view = renderContainerItemTable({
    onBlankContextMenu: (event, containerId) => {
      event.preventDefault();
      containerIds.push(containerId);
    },
  });
  const tableFrame = view.container.querySelector(".explorer-item-table-wrap");
  if (!tableFrame) {
    throw new Error("Expected explorer item table frame.");
  }

  const defaultAllowed = fireEvent.contextMenu(tableFrame);

  expect(defaultAllowed).toBe(false);
  expect(containerIds).toEqual(["root-container"]);
});

test("container item table places the columns menu in the last header", () => {
  const view = renderContainerItemTable({
    hiddenColumns: new Set<ExplorerItemColumnId>(["sync"]),
  });
  const headerCells = Array.from(view.container.querySelectorAll("thead th"));
  const columnsButton = view.getByRole("button", {
    name: EXPLORER_LABELS.columnsMenuButton,
  });

  expect(headerCells.at(-1)?.contains(columnsButton)).toBe(true);
});

test("container item table opens the context menu from the empty row", () => {
  const containerIds: string[] = [];
  const view = renderContainerItemTable({
    onBlankContextMenu: (_event, containerId) => {
      containerIds.push(containerId);
    },
  });
  const emptyCell = view.container.querySelector(".mini-app-table-empty");
  if (!emptyCell) {
    throw new Error("Expected explorer item table empty row.");
  }

  fireEvent.contextMenu(emptyCell);

  expect(containerIds).toEqual(["root-container"]);
});

test("container item table opens the context menu from virtual spacers", () => {
  const containerIds: string[] = [];
  const view = renderContainerItemTable({
    onBlankContextMenu: (_event, containerId) => {
      containerIds.push(containerId);
    },
    rowOffset: 1,
    totalCount: 2,
  });
  const spacerRow = view.container.querySelector(
    ".mini-app-virtual-table-spacer-row",
  );
  if (!spacerRow) {
    throw new Error("Expected explorer item table virtual spacer.");
  }

  fireEvent.contextMenu(spacerRow);

  expect(containerIds).toEqual(["root-container"]);
});

test("container item table does not open the blank context menu from item rows", () => {
  const containerIds: string[] = [];
  const view = renderContainerItemTable({
    onBlankContextMenu: (_event, containerId) => {
      containerIds.push(containerId);
    },
    rows: [archiveRow],
    totalCount: 1,
  });
  const itemRow = view.container.querySelector(".explorer-item-table-row");
  if (!itemRow) {
    throw new Error("Expected explorer item table row.");
  }

  fireEvent.contextMenu(itemRow);

  expect(containerIds).toEqual([]);
});

test("container item table opens the per-item context menu from an item row", () => {
  const rows: ContainerItemRow[] = [];
  const view = renderContainerItemTable({
    onItemContextMenu: (_event, row) => {
      rows.push(row);
    },
    rows: [archiveRow],
    totalCount: 1,
  });
  const itemRow = view.container.querySelector(".explorer-item-table-row");
  if (!itemRow) {
    throw new Error("Expected explorer item table row.");
  }

  fireEvent.contextMenu(itemRow);

  expect(rows).toEqual([archiveRow]);
});

test("container item table highlights the row matching the open context menu", () => {
  const view = renderContainerItemTable({
    contextTarget: { containerId: "archive-container", kind: "container" },
    rows: [archiveRow, noteRow],
    totalCount: 2,
  });
  const selectedRows = view.container.querySelectorAll(
    ".mini-app-table-row--selected",
  );

  expect(selectedRows.length).toBe(1);
  expect(selectedRows[0]?.textContent).toContain("Archive");
});

test("container item table highlights the document row matching the context menu", () => {
  const view = renderContainerItemTable({
    contextTarget: {
      containerId: "root-container",
      kind: "document",
      localId: "note-local",
    },
    rows: [archiveRow, noteRow],
    totalCount: 2,
  });
  const selectedRows = view.container.querySelectorAll(
    ".mini-app-table-row--selected",
  );

  expect(selectedRows.length).toBe(1);
  expect(selectedRows[0]?.textContent).toContain("Note");
});

test("container item table highlights no row when the context menu is closed", () => {
  const view = renderContainerItemTable({
    contextTarget: null,
    rows: [archiveRow, noteRow],
    totalCount: 2,
  });

  expect(
    view.container.querySelectorAll(".mini-app-table-row--selected").length,
  ).toBe(0);
});

test("container item table labels only the current self contact as You", () => {
  const view = renderContainerItemTable({
    currentSigningFingerprint: "current-fingerprint",
    currentUserId: "current-user-id",
    rows: [
      currentSelfContactRow,
      namedCurrentSelfContactRow,
      ownerSelfContactRow,
    ],
    totalCount: 3,
  });

  expect(view.getByRole("button", { name: "You" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Local Admin" })).toBeTruthy();
  expect(view.getByRole("button", { name: "owner-user-id" })).toBeTruthy();
});

test("container item table navigates when an item row is clicked", () => {
  const selectedIds: Array<string | null> = [];
  const view = renderContainerItemTable({
    rows: [archiveRow],
    setSelectedId: (id) => {
      selectedIds.push(id);
    },
    totalCount: 1,
  });
  // The whole row is the navigable target: it exposes a button role named after
  // the item so callers (and end-to-end tests) can find and activate it.
  const itemRow = view.getByRole("button", { name: archiveRow.name });

  fireEvent.click(itemRow);

  expect(selectedIds).toEqual(["archive-container"]);
});
