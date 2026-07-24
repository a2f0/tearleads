import { afterEach, expect, test } from "bun:test";
import {
  type ContainerItemRow,
  type ContainerItemSort,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { ROUTED_TABLET_QUERY } from "../../../../navigation/breakpoints";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerItemTable } from "./ExplorerContainerItemTable";
import type { ExplorerItemColumnId } from "./explorerItemColumnIds";

/**
 * The phone tier folds the explorer item row into a two-line summary column:
 * line one is the name button, line two is the muted type, and a larger visual
 * spans both. The pitch that the rendered row, the virtual spacers and the
 * frame's CSS variable all agree on is asserted here, because a mismatch shows
 * up as blank bands while scrolling rather than as a visibly broken row.
 */

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.window ?? {},
  "matchMedia",
);

afterEach(() => {
  cleanup();
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.removeAttribute("data-navigation-mode");

  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
    return;
  }

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: undefined,
  });
});

function mockLayout(params: {
  navigationMode: "routed" | "windowed";
  tier: "mobile" | "tablet";
}) {
  document.documentElement.setAttribute(
    "data-navigation-mode",
    params.navigationMode,
  );
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: query === ROUTED_TABLET_QUERY && params.tier === "tablet",
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}

function mockPhoneLayout() {
  mockLayout({ navigationMode: "routed", tier: "mobile" });
}

const selectedNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "Root",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

const archiveRow: ContainerItemRow = {
  createdAt: "2026-05-20T12:00:00.000Z",
  id: "archive-container",
  itemKind: "container",
  name: "Archive",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: "2026-05-21T12:00:00.000Z",
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

// The detail pane resolves compact/rowHeight and hands them down, so a folded
// render is expressed by passing them rather than by faking a viewport. The
// routed mock stays: it still drives the touch-only kebab column.
function renderFoldedItemTable(
  overrides: Partial<ExplorerContainerItemTableProps> = {},
) {
  mockPhoneLayout();
  return renderContainerItemTable({
    compact: true,
    rowHeight: 56,
    ...overrides,
  });
}

function getItemTableFrame(view: ReturnType<typeof render>): HTMLElement {
  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }

  return frame;
}

test("phone container item table folds the row into a summary and a kebab", () => {
  const view = renderFoldedItemTable({
    rows: [archiveRow],
    totalCount: 1,
  });

  expect(view.container.querySelectorAll("thead th")).toHaveLength(2);
  expect(
    view.container.querySelectorAll(
      ".explorer-item-table-row .mini-app-table-cell",
    ),
  ).toHaveLength(2);
  expect(
    view.queryByRole("columnheader", { name: EXPLORER_LABELS.itemSyncColumn }),
  ).toBeNull();
});

test("phone container item table spans a large visual beside name and type", () => {
  const view = renderFoldedItemTable({
    rows: [noteRow],
    totalCount: 1,
  });
  const summary = view.container.querySelector(".explorer-item-summary");
  const nameButton = summary?.querySelector(".explorer-item-row-button");
  if (!nameButton) {
    throw new Error("Expected the item name button in the summary.");
  }

  // The screenshot and dual-pane suites locate rows through this button and its
  // document id, so the fold must preserve both.
  expect(nameButton.getAttribute("data-document-local-id")).toBe(
    noteRow.localId,
  );
  const icon = summary?.querySelector(".explorer-item-summary-visual svg");
  expect(icon?.getAttribute("width")).toBe("32");
  expect(icon?.getAttribute("height")).toBe("32");
});

test("phone container item table puts only type beneath the name", () => {
  const view = renderFoldedItemTable({
    rows: [archiveRow],
    totalCount: 1,
  });
  const type = view.container.querySelector(".explorer-item-summary-type");

  expect(type?.textContent).toBe(
    `${EXPLORER_LABELS.itemTypeColumn}: ${EXPLORER_LABELS.folderType}`,
  );
  expect(view.container.textContent).not.toContain(
    EXPLORER_LABELS.dateModifiedColumnCompact,
  );
});

test("phone container item table names the row button by the item name alone", () => {
  const view = renderFoldedItemTable({
    rows: [archiveRow],
    totalCount: 1,
  });

  // The kind used to be folded into the accessible name because Type was
  // dropped on phone; now that line two carries it, that would double-announce.
  expect(view.getByRole("button", { name: archiveRow.name })).toBeTruthy();
  expect(
    view.queryByRole("button", {
      name: `${archiveRow.name}, ${EXPLORER_LABELS.folderType}`,
    }),
  ).toBeNull();
});

test("phone container item table sets the two-line modifier and the 56px pitch", () => {
  const view = renderFoldedItemTable({
    rows: [archiveRow],
    totalCount: 1,
  });
  const frame = getItemTableFrame(view);

  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(true);
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
});

test("phone container item table sizes the virtual spacer from the same pitch", () => {
  const view = renderFoldedItemTable({
    rowOffset: 3,
    rows: [archiveRow],
    totalCount: 50,
  });
  const spacerRow = view.container.querySelector(
    ".mini-app-virtual-table-spacer-row",
  );
  if (!(spacerRow instanceof HTMLElement)) {
    throw new Error("Expected a virtual spacer row.");
  }

  expect(spacerRow.style.height).toBe("168px");
  expect(spacerRow.querySelector("td")?.getAttribute("colspan")).toBe("2");
});

test("phone container item table spans the empty row across both columns", () => {
  const view = renderFoldedItemTable({ rows: [], totalCount: 0 });

  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();
  expect(
    view.container
      .querySelector(".mini-app-table-empty")
      ?.getAttribute("colspan"),
  ).toBe("2");
});

test("phone container item table sorts from the summary header", () => {
  const sortKeys: Array<ContainerItemSort["key"]> = [];
  const view = renderFoldedItemTable({
    onSort: (key) => {
      sortKeys.push(key);
    },
    rows: [archiveRow],
    totalCount: 1,
  });

  const triggerName = `${EXPLORER_LABELS.itemSortMenuLabel}: ${EXPLORER_LABELS.itemNameColumn}, ${EXPLORER_LABELS.columnSortedAscending}`;
  fireEvent.click(view.getByRole("combobox", { name: triggerName }));
  fireEvent.click(
    view.getByRole("option", {
      name: EXPLORER_LABELS.dateModifiedColumnCompact,
    }),
  );
  fireEvent.click(view.getByRole("combobox", { name: triggerName }));
  fireEvent.click(
    view.getByRole("option", { name: EXPLORER_LABELS.itemTypeColumn }),
  );

  expect(sortKeys).toEqual(["modified", "type"]);
});

test("phone container item table displays only the active sort field", () => {
  const view = renderFoldedItemTable({
    rows: [archiveRow],
    sort: { direction: "desc", key: "modified" },
    totalCount: 1,
  });

  expect(
    view.container.querySelector("thead th")?.getAttribute("aria-sort"),
  ).toBe("descending");
  expect(
    view.getByRole("combobox", {
      name: `${EXPLORER_LABELS.itemSortMenuLabel}: ${EXPLORER_LABELS.dateModifiedColumnCompact}, ${EXPLORER_LABELS.columnSortedDescending}`,
    }),
  ).toBeTruthy();
  expect(
    view.getByText(`${EXPLORER_LABELS.dateModifiedColumnCompact} ↓`),
  ).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.itemTypeColumn)).toBeNull();
  expect(view.queryByText(EXPLORER_LABELS.itemNameColumn)).toBeNull();

  fireEvent.click(view.getByRole("combobox"));
  expect(view.getAllByRole("option")).toHaveLength(4);

  cleanup();
  const createdSortView = renderFoldedItemTable({
    rows: [archiveRow],
    sort: { direction: "asc", key: "created" },
    totalCount: 1,
  });

  expect(
    createdSortView.getByRole("combobox", {
      name: `${EXPLORER_LABELS.itemSortMenuLabel}: ${EXPLORER_LABELS.dateCreatedColumn}, ${EXPLORER_LABELS.columnSortedAscending}`,
    }),
  ).toBeTruthy();
  expect(
    createdSortView.getByText(`${EXPLORER_LABELS.dateCreatedColumn} ↑`),
  ).toBeTruthy();
});

test("phone container item table opens the per-item menu from the actions kebab", () => {
  const rows: ContainerItemRow[] = [];
  const selectedIds: Array<string | null> = [];
  const view = renderFoldedItemTable({
    onItemContextMenu: (event, row) => {
      event.preventDefault();
      event.stopPropagation();
      rows.push(row);
    },
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

  expect(rows).toEqual([archiveRow]);
  expect(selectedIds).toEqual([]);
});

test("unfolded container item table keeps its wide columns and pitch", () => {
  // The detail pane decides the fold; the table renders what it is handed. Its
  // half of the contract is that an unfolded render keeps every data column and
  // the pitch it was given.
  mockLayout({ navigationMode: "routed", tier: "tablet" });
  const view = renderContainerItemTable({
    rowHeight: 44,
    rows: [archiveRow],
    totalCount: 1,
  });
  const frame = getItemTableFrame(view);

  expect(
    view.container.querySelector(".mini-app-compact-table-lines"),
  ).toBeNull();
  expect(
    view.queryByRole("columnheader", { name: EXPLORER_LABELS.itemSyncColumn }),
  ).not.toBeNull();
  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "44px",
  );
});
