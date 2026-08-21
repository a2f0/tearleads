import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobStore } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { BlobInfoTable } from "./BlobInfoTable";
import { BLOB_LIST_LABELS } from "./blobListLabels";

/**
 * A narrow frame (a phone, or any pane too narrow for six columns) folds the
 * blob row into a two-line summary column: the thumbnail spans both lines, line
 * one is the first visible data column and line two carries the rest, muted.
 * The pitch that the rendered row, the virtual spacers and the frame's CSS
 * variable all agree on is asserted here, because a mismatch shows up as blank
 * bands while scrolling rather than as a visibly broken row.
 */

const STORAGE_KEY = "symcrypt.blob-browser:hidden-columns:v3";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

const BLOB_STORE: BlobStore = {
  deleteBytes: async () => undefined,
  openByteSource: async () => null,
  readBytes: async () => null,
  writeByteSource: async () => undefined,
  writeBytes: async () => undefined,
};

const BLOB: BlobInfo = {
  blobId: "blob-1",
  byteLength: 12,
  createdAt: null,
  documentCount: 1,
  key: "blob:blob-1",
  mimeType: "text/plain",
  name: "example.txt",
  organizationId: null,
  referenceCount: 1,
  references: [],
  storageKey: "storage-1",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

type BlobInfoTableProps = ComponentProps<typeof BlobInfoTable>;

function renderBlobInfoTable(overrides: Partial<BlobInfoTableProps> = {}) {
  return render(
    <BlobInfoTable
      activeBlob={null}
      blobStore={BLOB_STORE}
      compact={false}
      error={null}
      frameRef={() => undefined}
      isLoading={false}
      online
      onSelectBlob={() => undefined}
      onSort={() => undefined}
      renderSyncCell={() => <span data-testid="sync-cell">Synced</span>}
      rowHeight={36}
      rowOffset={0}
      rows={[BLOB]}
      sort={{ direction: "desc", key: "updated" }}
      totalCount={1}
      {...overrides}
    />,
  );
}

// The list data hook decides the fold and hands down the pitch, so a folded
// render is expressed by passing them rather than by faking a viewport.
function renderFoldedBlobInfoTable(
  overrides: Partial<BlobInfoTableProps> = {},
) {
  return renderBlobInfoTable({ compact: true, rowHeight: 56, ...overrides });
}

function getTableFrame(view: ReturnType<typeof render>): HTMLElement {
  const frame = view.container.querySelector(
    ".explorer-blob-browser-table-wrap",
  );
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the blob browser table frame.");
  }

  return frame;
}

function getCompactLines(
  view: ReturnType<typeof render>,
): ReadonlyArray<ReadonlyArray<string>> {
  return Array.from(
    view.container.querySelectorAll(
      ".explorer-blob-browser-table-row .mini-app-compact-table-line",
    ),
    (line) =>
      Array.from(
        line.querySelectorAll(".mini-app-compact-table-field"),
        (field) => field.textContent ?? "",
      ),
  );
}

test("folded blob list collapses its columns into one summary column", () => {
  const view = renderFoldedBlobInfoTable();

  expect(view.container.querySelectorAll("thead th")).toHaveLength(1);
  expect(
    view.getByRole("columnheader", {
      name: `${BLOB_LIST_LABELS.blobColumn}:`,
    }),
  ).toBeTruthy();
  expect(
    view.container.querySelectorAll(
      ".explorer-blob-browser-table-row .mini-app-table-cell",
    ),
  ).toHaveLength(1);
});

test("folded blob row stacks the first column over the rest", () => {
  const view = renderFoldedBlobInfoTable();
  const lines = getCompactLines(view);

  // Organization and Sync are hidden by default, so MIME leads and the three
  // remaining visible columns share the muted second line.
  expect(lines[0]).toEqual([`${BLOB_LIST_LABELS.mimeTypeColumn}: text/plain`]);
  expect(lines[1]?.slice(0, 2)).toEqual([
    `${BLOB_LIST_LABELS.sizeColumn}: 12 B`,
    `${BLOB_LIST_LABELS.referenceColumn}: 1 reference`,
  ]);
  // Updated closes the line; its text is timezone-dependent, so only its
  // presence is asserted.
  expect(lines[1]).toHaveLength(3);
  expect(
    view.container.querySelector(".mini-app-compact-table-line--muted"),
  ).toBeTruthy();
});

test("folded blob row hides the sync badge until the column is enabled", () => {
  // The badge is a narrow glyph that would take an equal share of the second
  // line, leaving the fields beside it short of the row's trailing edge.
  const view = renderFoldedBlobInfoTable();

  expect(view.queryByTestId("sync-cell")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Columns" }));
  fireEvent.click(
    view.getByRole("checkbox", {
      name: `${BLOB_LIST_LABELS.syncColumn} ${BLOB_LIST_LABELS.columnsMenuStateOff}`,
    }),
  );

  expect(view.getByTestId("sync-cell")).toBeTruthy();
  expect(getCompactLines(view)[1]).toHaveLength(4);
});

function getVisualTitle(view: ReturnType<typeof render>): string | null {
  const titled = view.container.querySelector(
    ".mini-app-compact-table-visual [title]",
  );
  return titled?.getAttribute("title") ?? null;
}

test("folded blob row covers both lines with the thumbnail", () => {
  const view = renderFoldedBlobInfoTable();
  const visual = view.container.querySelector(".mini-app-compact-table-visual");
  const identityButton = view.getByRole("button", { name: "blob-1" });

  // The virtual and pick suites locate rows through this button, so the fold
  // must preserve it — promoted to the summary's spanning visual.
  expect(visual?.contains(identityButton)).toBe(true);
  expect(
    identityButton.querySelector(".explorer-blob-browser-thumb--compact"),
  ).toBeTruthy();
  // The square in BlobList.css is the only thing that sizes a folded thumbnail,
  // so the glyph fills it rather than carrying a px size of its own.
  expect(identityButton.querySelector("svg")?.getAttribute("width")).toBe(
    "100%",
  );
  expect(getVisualTitle(view)).toBe("blob-1");
});

test("folded blob row hints why a non-image row cannot be picked", () => {
  const view = renderFoldedBlobInfoTable({ isRowSelectable: () => false });

  // A disabled button does not reliably show a `title`, so the hint rides on the
  // never-disabled element wrapping it.
  expect(getVisualTitle(view)).toBe(BLOB_LIST_LABELS.pickUnavailableHint);
  expect(
    view.getByRole("button", { name: "blob-1" }).hasAttribute("disabled"),
  ).toBe(true);
});

test("folded blob list sets the two-line modifier and the 56px pitch", () => {
  const frame = getTableFrame(renderFoldedBlobInfoTable());

  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(true);
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
});

test("folded blob list sizes its spacers and empty row from the same pitch", () => {
  const view = renderFoldedBlobInfoTable({ rowOffset: 3, totalCount: 50 });
  const spacerRow = view.container.querySelector(
    ".mini-app-virtual-table-spacer-row",
  );
  if (!(spacerRow instanceof HTMLElement)) {
    throw new Error("Expected a virtual spacer row.");
  }

  expect(spacerRow.style.height).toBe("168px");
  expect(spacerRow.querySelector("td")?.getAttribute("colspan")).toBe("1");

  cleanup();
  const emptyView = renderFoldedBlobInfoTable({ rows: [], totalCount: 0 });
  expect(emptyView.getByText(BLOB_LIST_LABELS.empty)).toBeTruthy();
  expect(
    emptyView.container
      .querySelector(".mini-app-table-empty")
      ?.getAttribute("colspan"),
  ).toBe("1");
});

test("folded blob list sorts from the summary header menu", () => {
  const sortKeys: string[] = [];
  const view = renderFoldedBlobInfoTable({
    onSort: (key) => sortKeys.push(key),
  });
  const triggerName = `${BLOB_LIST_LABELS.sortMenuLabel}: ${BLOB_LIST_LABELS.updatedColumn}, ${BLOB_LIST_LABELS.columnSortedDescending}`;
  const trigger = view.getByRole("combobox", { name: triggerName });

  expect(trigger.textContent).toContain(BLOB_LIST_LABELS.updatedColumn);
  fireEvent.click(trigger);
  // Portaled, so the open listbox escapes the scroll frame rather than being
  // clipped by it.
  const listbox = view.getByRole("listbox");
  expect(getTableFrame(view).contains(listbox)).toBe(false);
  fireEvent.click(
    view.getByRole("option", { name: BLOB_LIST_LABELS.mimeTypeColumn }),
  );

  fireEvent.click(view.getByRole("combobox", { name: triggerName }));
  fireEvent.click(
    view.getByRole("option", {
      // Repeating the active key reverses it.
      name: `${BLOB_LIST_LABELS.updatedColumn} ${BLOB_LIST_LABELS.columnSortedDescending}. ${BLOB_LIST_LABELS.sortReverseAction}`,
    }),
  );

  expect(sortKeys).toEqual(["mimeType", "updated"]);
});

test("folded blob list still trims its second line from the columns menu", () => {
  const view = renderFoldedBlobInfoTable();

  fireEvent.click(view.getByRole("button", { name: "Columns" }));
  fireEvent.click(
    view.getByRole("checkbox", {
      name: `${BLOB_LIST_LABELS.referenceColumn} ${BLOB_LIST_LABELS.columnsMenuStateOn}`,
    }),
  );

  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toContain("references");
  expect(getCompactLines(view)[1]).toHaveLength(2);
});

test("unfolded blob list keeps its wide columns and pitch", () => {
  const view = renderBlobInfoTable();
  const frame = getTableFrame(view);

  // Blob, MIME, Size, References, Updated — Organization and Sync stay hidden.
  expect(view.container.querySelectorAll("thead th")).toHaveLength(5);
  expect(
    view.queryByRole("columnheader", { name: BLOB_LIST_LABELS.blobColumn }),
  ).not.toBeNull();
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
