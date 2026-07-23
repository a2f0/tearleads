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
import { formatMiniAppDate } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerItemTable } from "./ExplorerContainerItemTable";
import type { ExplorerItemColumnId } from "./explorerItemColumnIds";

/**
 * The phone tier folds the explorer item row into a two-line summary column:
 * line one is the name button, line two is the muted Type + Modified pair. The
 * pitch that the rendered row, the virtual spacers and the frame's CSS variable
 * all agree on is asserted here, because a mismatch shows up as blank bands
 * while scrolling rather than as a visibly broken row.
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

function getItemTableFrame(view: ReturnType<typeof render>): HTMLElement {
  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }

  return frame;
}

test("phone container item table folds the row into a summary and a kebab", () => {
  mockPhoneLayout();
  const view = renderContainerItemTable({
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

test("phone container item table keeps the name button on the first line", () => {
  mockPhoneLayout();
  const view = renderContainerItemTable({
    rows: [noteRow],
    totalCount: 1,
  });
  const lines = view.container.querySelectorAll(
    "tbody .mini-app-compact-table-line",
  );

  expect(lines).toHaveLength(2);
  const nameButton = lines.item(0).querySelector(".explorer-item-row-button");
  if (!nameButton) {
    throw new Error("Expected the item name button on the first line.");
  }

  // The screenshot and dual-pane suites locate rows through this button and its
  // document id, so the fold must not move either out of it.
  expect(nameButton.querySelector(".explorer-item-icon")).not.toBeNull();
  expect(nameButton.getAttribute("data-document-local-id")).toBe(
    noteRow.localId,
  );
});

test("phone container item table labels the secondary fields for screen readers", () => {
  mockPhoneLayout();
  const view = renderContainerItemTable({
    rows: [archiveRow],
    totalCount: 1,
  });
  const secondaryLine = view.container
    .querySelectorAll("tbody .mini-app-compact-table-line")
    .item(1);

  expect(
    Array.from(
      secondaryLine.querySelectorAll(".mini-app-compact-table-field"),
      (field) => field.textContent,
    ),
  ).toEqual([
    // The leading empty gutter keeps this line's tracks under the header's.
    "",
    `${EXPLORER_LABELS.itemTypeColumn}: ${EXPLORER_LABELS.folderType}`,
    `${EXPLORER_LABELS.dateModifiedColumnCompact}: ${formatMiniAppDate(
      archiveRow.updatedAt,
      { emptyFallback: EXPLORER_LABELS.unknownDate },
    )}`,
  ]);
  expect(
    secondaryLine.classList.contains("mini-app-compact-table-line--muted"),
  ).toBe(true);
});

test("phone container item table names the row button by the item name alone", () => {
  mockPhoneLayout();
  const view = renderContainerItemTable({
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
  mockPhoneLayout();
  const view = renderContainerItemTable({
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
  mockPhoneLayout();
  const view = renderContainerItemTable({
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
  mockPhoneLayout();
  const view = renderContainerItemTable({ rows: [], totalCount: 0 });

  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();
  expect(
    view.container
      .querySelector(".mini-app-table-empty")
      ?.getAttribute("colspan"),
  ).toBe("2");
});

test("phone container item table sorts from the summary header", () => {
  mockPhoneLayout();
  const sortKeys: Array<ContainerItemSort["key"]> = [];
  const view = renderContainerItemTable({
    onSort: (key) => {
      sortKeys.push(key);
    },
    rows: [archiveRow],
    totalCount: 1,
  });

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.dateModifiedColumnCompact,
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.itemTypeColumn }),
  );

  expect(sortKeys).toEqual(["modified", "type"]);
});

test("phone container item table announces the active sort on its control", () => {
  mockPhoneLayout();
  const view = renderContainerItemTable({
    rows: [archiveRow],
    sort: { direction: "desc", key: "modified" },
    totalCount: 1,
  });

  // The summary <th> heads three sort keys at once, so a direction on the cell
  // would name one without saying which; the active control carries it instead.
  expect(
    view.container.querySelector("thead th")?.getAttribute("aria-sort"),
  ).toBe("none");
  expect(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.dateModifiedColumnCompact}, ${EXPLORER_LABELS.columnSortedDescending}`,
    }),
  ).toBeTruthy();
  // The inactive controls keep their bare label.
  expect(
    view.getByRole("button", { name: EXPLORER_LABELS.itemTypeColumn }),
  ).toBeTruthy();
  expect(
    view.getByRole("button", { name: EXPLORER_LABELS.itemNameColumn }),
  ).toBeTruthy();

  cleanup();
  const createdSortView = renderContainerItemTable({
    rows: [archiveRow],
    sort: { direction: "asc", key: "created" },
    totalCount: 1,
  });

  // Created is not one of the folded controls, so none of them is active.
  expect(
    createdSortView.getByRole("button", {
      name: EXPLORER_LABELS.dateModifiedColumnCompact,
    }),
  ).toBeTruthy();
});

test("phone container item table opens the per-item menu from the actions kebab", () => {
  mockPhoneLayout();
  const rows: ContainerItemRow[] = [];
  const selectedIds: Array<string | null> = [];
  const view = renderContainerItemTable({
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

test("routed tablet container item table keeps the wide columns at the touch pitch", () => {
  mockLayout({ navigationMode: "routed", tier: "tablet" });
  const view = renderContainerItemTable({
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
  // The window hook already bumps its own pitch to the 44px touch target; the
  // rendered pitch has to match it or the served offsets drift from the layout.
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "44px",
  );
});

test("narrow windowed container item table stays single-line", () => {
  mockLayout({ navigationMode: "windowed", tier: "mobile" });
  const view = renderContainerItemTable({
    rows: [archiveRow],
    totalCount: 1,
  });
  const frame = getItemTableFrame(view);

  expect(
    view.container.querySelector(".mini-app-compact-table-lines"),
  ).toBeNull();
  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "36px",
  );
});
