import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import {
  archiveRow,
  noteRow,
  renderContainerItemTable,
} from "../../../../../test/helpers/explorer/containerItemTableFixtures";
import { EXPLORER_LABELS } from "../../labels";

/*
 * The row-wide hit area is the row's own click handler, not a CSS overlay
 * stretched out of the name button: WebKit (every iOS browser, and the Capacitor
 * WKWebView) does not make a relatively positioned `<tr>` a containing block, so
 * such an overlay resolved against the scroll frame instead of the row. Every
 * row's overlay then covered the whole list and the last one won hit-testing, so
 * every tap opened the bottom item.
 */
afterEach(cleanup);

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
