import { afterEach, expect, test } from "bun:test";
import {
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerItemTable } from "./ExplorerContainerItemTable";
import type { ExplorerItemColumnId } from "./explorerItemColumnIds";

/*
 * The row-wide hit area is the row's own click handler, not a CSS overlay
 * stretched out of the name button: WebKit (every iOS browser, and the Capacitor
 * WKWebView) does not make a relatively positioned `<tr>` a containing block, so
 * such an overlay resolved against the scroll frame instead of the row. Every
 * row's overlay then covered the whole list and the last one won hit-testing, so
 * every tap opened the bottom item.
 */

afterEach(cleanup);

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

type ExplorerContainerItemTableProps = ComponentProps<
  typeof ExplorerContainerItemTable
>;

function renderContainerItemTable(
  overrides: Partial<ExplorerContainerItemTableProps>,
) {
  return render(
    createElement(ExplorerContainerItemTable, {
      compact: false,
      contactAvatarUrlByLocalId: {},
      contextTarget: null,
      currentSigningFingerprint: null,
      currentSelfContactLocalId: null,
      currentUserId: null,
      dragActive: false,
      dragDisabled: false,
      emptyLabel: EXPLORER_LABELS.itemTableEmpty,
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
      rowHeight: 36,
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

// A cell that is not the name cell, so the click lands outside every control in
// the row and only the row's own handler can open the item.
function getExplorerItemRowCellOutsideTheNameButton(
  container: HTMLElement,
): Element {
  const cell = container.querySelectorAll(
    ".explorer-item-table-row .mini-app-table-cell",
  )[1];
  if (!cell) {
    throw new Error("Expected a second cell in the explorer item row.");
  }

  return cell;
}

test("container item table opens a container from a click outside the name button", () => {
  const selectedIds: Array<string | null> = [];
  const view = renderContainerItemTable({
    rows: [archiveRow],
    setSelectedId: (id) => {
      selectedIds.push(id);
    },
    totalCount: 1,
  });

  fireEvent.click(getExplorerItemRowCellOutsideTheNameButton(view.container));

  expect(selectedIds).toEqual(["archive-container"]);
});

test("container item table opens a document from a click outside the name button", () => {
  const opened: Array<[string, string]> = [];
  const view = renderContainerItemTable({
    rows: [noteRow],
    selectDocumentProjection: (documentId, containerId) => {
      opened.push([documentId, containerId]);
    },
    totalCount: 1,
  });

  fireEvent.click(getExplorerItemRowCellOutsideTheNameButton(view.container));

  expect(opened).toEqual([["note-local", "root-container"]]);
});

test("container item table opens an item once when its name button is clicked", () => {
  const selectedIds: Array<string | null> = [];
  const view = renderContainerItemTable({
    rows: [archiveRow],
    setSelectedId: (id) => {
      selectedIds.push(id);
    },
    totalCount: 1,
  });

  // The click bubbles to the row, whose handler must defer to the control the
  // click actually landed on rather than opening the item a second time.
  fireEvent.click(view.getByRole("button", { name: archiveRow.name }));

  expect(selectedIds).toEqual(["archive-container"]);
});

test("container item table does not open the item from the actions kebab", () => {
  // The kebab renders in every layout, so this holds without stamping one: a
  // click on it opens the row's menu and must not also open the row.
  const selectedIds: Array<string | null> = [];
  const view = renderContainerItemTable({
    rows: [archiveRow],
    setSelectedId: (id) => {
      selectedIds.push(id);
    },
    totalCount: 1,
  });

  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.itemActionsButtonPrefix} ${archiveRow.name}`,
    }),
  );

  expect(selectedIds).toEqual([]);
});
