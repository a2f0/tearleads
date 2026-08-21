import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobInfoDocumentReference } from "@symcrypt/client-sdk";
import { cleanup, render, within } from "@testing-library/react";
import { ROUTED_TABLET_QUERY } from "../../../../navigation/breakpoints";
import { EXPLORER_LABELS } from "../../labels";
import { compactId } from "../compactId";
import { BlobReferencesSection } from "./ExplorerBlobReferencesSection";

/**
 * The blob browser's Document Links table carries a document beside three
 * squeezable ids/states, so a phone — or any pane narrow enough to fold the
 * explorer's own item list — folds it onto two lines instead of shaving each
 * column to an ellipsis. The section renders every reference (it scrolls with
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
  expect(
    within(headerLines.item(0)).getByText(
      EXPLORER_LABELS.blobBrowserDocumentColumn,
    ),
  ).toBeTruthy();
  expect(
    Array.from(
      headerLines.item(1).querySelectorAll(".mini-app-compact-table-field"),
      (field) => field.textContent,
    ),
  ).toEqual([
    EXPLORER_LABELS.documentInfoContainerColumn,
    EXPLORER_LABELS.blobBrowserStateColumn,
    EXPLORER_LABELS.blobBrowserSlotColumn,
  ]);

  // One cell, and the container/state/slot trio muted beneath the document.
  expect(table.querySelectorAll("tbody .mini-app-table-cell")).toHaveLength(1);
  expect(bodyLines).toHaveLength(2);
  expect(
    within(bodyLines.item(0)).getByRole("button", { name: "Roadmap notes" }),
  ).toBeTruthy();
  expect(
    Array.from(
      bodyLines.item(1).querySelectorAll(".mini-app-compact-table-field"),
      (field) => field.textContent,
    ),
  ).toEqual([
    `${EXPLORER_LABELS.documentInfoContainerColumn}: Roadmap`,
    `${EXPLORER_LABELS.blobBrowserStateColumn}: ${EXPLORER_LABELS.documentInfoAttachmentStateLocal}`,
    `${EXPLORER_LABELS.blobBrowserSlotColumn}: ${compactId(SLOT_ID)}`,
  ]);
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

test("document links keep four columns in a wide frame", () => {
  document.documentElement.setAttribute("data-navigation-mode", "windowed");
  mockFrameWidth(900);
  const view = renderReferences();
  const table = getReferenceTable(view);
  const frame = getFrame(table);

  expect(table.querySelectorAll("thead th")).toHaveLength(4);
  expect(table.querySelector(".mini-app-compact-table-lines")).toBeNull();
  expect(table.querySelectorAll("tbody .mini-app-table-cell")).toHaveLength(4);
  expect(view.getByRole("button", { name: "Roadmap notes" })).toBeTruthy();
  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame.classList.contains("mini-app-table-frame--compact")).toBe(false);
});

test("document links stay single-line on routed tablets", () => {
  mockRoutedLayout(true);
  const table = getReferenceTable(renderReferences());

  expect(table.querySelectorAll("thead th")).toHaveLength(4);
  expect(
    getFrame(table).classList.contains("mini-app-table-frame--two-line"),
  ).toBe(false);
});
