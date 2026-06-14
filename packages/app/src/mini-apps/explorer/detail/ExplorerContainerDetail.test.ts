import { afterEach, expect, test } from "bun:test";
import {
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { getNextExplorerItemSort } from "./ExplorerContainerDetail";
import { ExplorerContainerItemTable } from "./ExplorerContainerItemTable";

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

type ExplorerContainerItemTableProps = ComponentProps<
  typeof ExplorerContainerItemTable
>;

function renderContainerItemTable(
  overrides: Partial<ExplorerContainerItemTableProps>,
) {
  return render(
    createElement(ExplorerContainerItemTable, {
      dragActive: false,
      error: null,
      frameRef: () => undefined,
      handleDragEnter: () => undefined,
      handleDragLeave: () => undefined,
      handleDragOver: () => undefined,
      handleDrop: () => undefined,
      isImporting: false,
      isLoading: false,
      online: true,
      onBlankContextMenu: () => undefined,
      onSort: () => undefined,
      rows: [],
      rowOffset: 0,
      selectedNode,
      selectDocumentProjection: () => undefined,
      setSelectedId: () => undefined,
      sort: { direction: "asc", key: "name" },
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

test("container item table does not open the context menu from item rows", () => {
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
