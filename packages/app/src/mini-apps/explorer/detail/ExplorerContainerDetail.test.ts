import { afterEach, expect, test } from "bun:test";
import {
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
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
  const view = render(
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
      onBlankContextMenu: (event, containerId) => {
        event.preventDefault();
        containerIds.push(containerId);
      },
      onSort: () => undefined,
      rows: [],
      rowOffset: 0,
      selectedNode,
      selectDocumentProjection: () => undefined,
      setSelectedId: () => undefined,
      sort: { direction: "asc", key: "name" },
      totalCount: 0,
    }),
  );
  const tableFrame = view.container.querySelector(".explorer-item-table-wrap");
  if (!tableFrame) {
    throw new Error("Expected explorer item table frame.");
  }

  const defaultAllowed = fireEvent.contextMenu(tableFrame);

  expect(defaultAllowed).toBe(false);
  expect(containerIds).toEqual(["root-container"]);
});

test("container item table does not open the container context menu from table content", () => {
  const containerIds: string[] = [];
  const view = render(
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
      onBlankContextMenu: (_event, containerId) => {
        containerIds.push(containerId);
      },
      onSort: () => undefined,
      rows: [],
      rowOffset: 0,
      selectedNode,
      selectDocumentProjection: () => undefined,
      setSelectedId: () => undefined,
      sort: { direction: "asc", key: "name" },
      totalCount: 0,
    }),
  );

  fireEvent.contextMenu(view.getByRole("table", { name: "Items in Root" }));

  expect(containerIds).toEqual([]);
});
