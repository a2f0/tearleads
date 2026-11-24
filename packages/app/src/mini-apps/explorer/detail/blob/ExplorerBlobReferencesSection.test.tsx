import { afterEach, expect, test } from "bun:test";
import type {
  BlobInfo,
  BlobInfoDocumentReference,
} from "@tearleads/client-sdk";
import { ROUTED_TABLET_QUERY } from "@tearleads/windowing";
import { cleanup, render, within } from "@testing-library/react";
import { EXPLORER_LABELS } from "../../labels";
import { compactId } from "../compactId";
import { BlobReferencesSection } from "./ExplorerBlobReferencesSection";

/**
 * The blob browser's Document Links table carries a document beside its
 * filename, state, container, and slot, so a phone — or any pane narrow enough
 * to fold the explorer's own item list — folds it onto two lines instead of
 * shaving each column to an ellipsis. The section renders every reference (it scrolls with
 * the detail panel rather than windowing), so the fold rides on the frame width
 * alone; these assert both halves of that rule and that the row's way into the
 * document survives it.
 */

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.window ?? {},
  "matchMedia",
);
const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.HTMLElement?.prototype ?? {},
  "clientWidth",
);

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");

  if (originalClientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidthDescriptor,
    );
  }

  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

// happy-dom has no layout engine, so every clientWidth is 0 — which the fold
// predicate reads as "not measured" and ignores. Stand in for the layout the
// browser would do, which is the only way to exercise the width-driven fold
// outside Playwright.
function mockFrameWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
}

function mockRoutedLayout(tablet = false) {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: query === ROUTED_TABLET_QUERY && tablet,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}

const CONTAINER_ID = "550e8400-e29b-41d4-a716-446655440020";
const LOCAL_ID = "550e8400-e29b-41d4-a716-446655440021";
const SLOT_ID = "550e8400-e29b-41d4-a716-446655440022";

const REFERENCE: BlobInfoDocumentReference = {
  attachmentKind: "local",
  blobId: "blob-1",
  byteLength: 12,
  containerId: CONTAINER_ID,
  createdAt: null,
  documentId: "document-1",
  documentKind: "note",
  documentTitle: "Roadmap notes",
  localId: LOCAL_ID,
  mimeType: "text/plain",
  name: "example.txt",
  slotId: SLOT_ID,
  storageKey: "storage-1",
  updatedAt: "2026-05-17T00:00:00.000Z",
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
  references: [REFERENCE],
  storageKey: "storage-1",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

function renderReferences() {
  return render(
    <BlobReferencesSection
      blob={BLOB}
      containerNamesById={new Map([[CONTAINER_ID, "Roadmap"]])}
      openDocumentInfoRoute={() => undefined}
      selectDocumentProjection={() => undefined}
    />,
  );
}

function getReferenceTable(view: ReturnType<typeof render>): HTMLElement {
  return view.getByRole("table", {
    name: EXPLORER_LABELS.blobBrowserReferencesHeading,
  });
}

function getFrame(table: HTMLElement): HTMLElement {
  const frame = table.closest(".mini-app-table-frame");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the document links table frame.");
  }

  return frame;
}

const SECONDARY_LABEL = [
  EXPLORER_LABELS.blobBrowserStateColumn,
  EXPLORER_LABELS.documentInfoContainerColumn,
  EXPLORER_LABELS.blobBrowserFilenameColumn,
].join(" · ");

test("document links fold onto two lines on phones", () => {
  mockRoutedLayout();
  const view = renderReferences();
  const table = getReferenceTable(view);
  const headerLines = table.querySelectorAll<HTMLElement>(
    "thead .mini-app-compact-table-line",
  );
  const bodyLines = table.querySelectorAll<HTMLElement>(
    "tbody .mini-app-compact-table-line",
  );

  expect(table.querySelectorAll("thead th")).toHaveLength(1);
  expect(headerLines).toHaveLength(2);
  const fieldTexts = (line: HTMLElement) =>
    Array.from(
      line.querySelectorAll(".mini-app-compact-table-field"),
      (field) => field.textContent,
    );
  expect(fieldTexts(headerLines.item(0))).toEqual([
    EXPLORER_LABELS.blobBrowserDocumentColumn,
  ]);
  expect(fieldTexts(headerLines.item(1))).toEqual([SECONDARY_LABEL]);

  // One cell: the document's kind glyph spans both lines, the document leads
  // alone, and its state, container, and filename share one muted line, so
  // no value is squeezed into a third of a phone. The slot id stays wide-only.
  expect(table.querySelectorAll("tbody .mini-app-table-cell")).toHaveLength(1);
  expect(
    table.querySelector(
      'tbody .mini-app-compact-table-visual [data-icon="note"]',
    ),
  ).not.toBeNull();
  expect(bodyLines).toHaveLength(2);
  expect(fieldTexts(bodyLines.item(0))).toEqual(["Roadmap notes"]);
  expect(
    within(bodyLines.item(0)).getByRole("button", { name: "Roadmap notes" }),
  ).toBeTruthy();
  expect(fieldTexts(bodyLines.item(1))).toEqual([
    `${SECONDARY_LABEL}: ${EXPLORER_LABELS.documentInfoAttachmentStateLocal} · Roadmap · example.txt`,
  ]);
  expect(within(table).queryByText(compactId(SLOT_ID))).toBeNull();
  expect(
    bodyLines.item(1).classList.contains("mini-app-compact-table-line--muted"),
  ).toBe(true);

  const frame = getFrame(table);
  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(true);
  expect(frame.classList.contains("mini-app-table-frame--compact")).toBe(true);
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
});

test("document links fold when their own frame is narrow", () => {
  // A desktop window squeezed narrow, or the panel beside a dragged-open
  // sidebar: the viewport is wide and windowed, but the frame is not.
  document.documentElement.setAttribute("data-navigation-mode", "windowed");
  mockFrameWidth(320);
  const table = getReferenceTable(renderReferences());

  expect(table.querySelector(".mini-app-compact-table-lines")).not.toBeNull();
  expect(
    getFrame(table).classList.contains("mini-app-table-frame--two-line"),
  ).toBe(true);
});

test("document links show each document’s filename in a wide frame", () => {
  document.documentElement.setAttribute("data-navigation-mode", "windowed");
  mockFrameWidth(900);
  const view = renderReferences();
  const table = getReferenceTable(view);
  const frame = getFrame(table);
  expect(within(table).getByText("example.txt")).toBeTruthy();

  expect(table.querySelectorAll("thead th")).toHaveLength(5);
  expect(table.querySelector(".mini-app-compact-table-lines")).toBeNull();
  expect(table.querySelectorAll("tbody .mini-app-table-cell")).toHaveLength(5);
  expect(view.getByRole("button", { name: "Roadmap notes" })).toBeTruthy();
  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame.classList.contains("mini-app-table-frame--compact")).toBe(false);
});

test("document links stay single-line on routed tablets", () => {
  mockRoutedLayout(true);
  const table = getReferenceTable(renderReferences());

  expect(table.querySelectorAll("thead th")).toHaveLength(5);
  expect(
    getFrame(table).classList.contains("mini-app-table-frame--two-line"),
  ).toBe(false);
});
