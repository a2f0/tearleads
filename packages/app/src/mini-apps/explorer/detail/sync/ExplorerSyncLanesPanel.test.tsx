import { afterEach, expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import {
  createSnapshot,
  stubPhoneMatchMedia,
  updatedAt,
} from "../../../../../test/helpers/explorer/syncPanelFixtures";
import {
  ExplorerSyncLanesPanelView,
  getExplorerSyncLaneProgress,
} from "./ExplorerSyncLanesPanel";

let restorePhoneMatchMedia: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restorePhoneMatchMedia?.();
  restorePhoneMatchMedia = null;
  globalThis.localStorage.clear();
});

function createLaneSnapshot(
  overrides: Partial<SyncLaneSnapshot>,
): SyncLaneSnapshot {
  return {
    blobStorageKey: null,
    errorCount: 0,
    key: "container-contents",
    label: "Container contents",
    lastAction: "registered",
    lastActionAt: updatedAt,
    lastCompletedAt: null,
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: null,
    lastStartedAt: null,
    phase: "structural",
    progress: null,
    registrationIndex: 0,
    requestCount: 0,
    requested: false,
    runAbandoned: false,
    runCount: 0,
    runDurations: null,
    running: false,
    status: "idle",
    ...overrides,
  };
}

function renderSyncLanesPanel(input: {
  onOpenLaneDetail?: ((laneKey: string) => void) | undefined;
  selectedLaneKey?: string | null | undefined;
  snapshot: DomainSyncSnapshot;
}) {
  return render(
    createElement(ExplorerSyncLanesPanelView, {
      onBackToSelectionRoute: () => undefined,
      onOpenLaneDetail: input.onOpenLaneDetail ?? (() => undefined),
      selectedLaneKey: input.selectedLaneKey ?? null,
      snapshot: input.snapshot,
    }),
  );
}

function renderSyncLanesPanelOnPhone(input: {
  onOpenLaneDetail?: ((laneKey: string) => void) | undefined;
  snapshot: DomainSyncSnapshot;
}) {
  restorePhoneMatchMedia = stubPhoneMatchMedia();
  return renderSyncLanesPanel(input);
}

test("ExplorerSyncLanesPanelView renders lane status, progress, and counts", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      lastAction: "started",
      phase: "document",
      requestCount: 1,
      runCount: 1,
      running: true,
      status: "running",
    }),
    createLaneSnapshot({
      errorCount: 1,
      key: "documents:local-2",
      label: "Document local-2",
      lastAction: "failed",
      lastError: "boom",
      phase: "document",
      requestCount: 2,
      runCount: 2,
      status: "error",
    }),
  ]);

  const view = renderSyncLanesPanel({ snapshot });

  expect(view.getByText("Sync Lanes")).toBeTruthy();
  // Both document lanes roll up to the compact "Document" category label in the
  // lane column; the opaque local-id suffix stays out of the list entirely.
  const laneLabels = Array.from(
    view.container.querySelectorAll(".explorer-sync-lane-list-label"),
  );
  expect(laneLabels.map((node) => node.textContent)).toEqual([
    "Document",
    "Document",
  ]);
  expect(view.queryByText("Document local-1")).toBeNull();
  expect(view.queryByText("Document local-2")).toBeNull();
  expect(view.getAllByText("Running").length).toBeGreaterThan(0);
  expect(view.getAllByText("Error").length).toBeGreaterThan(0);
  expect(view.getByText("1 request, 1 run, 0 errors")).toBeTruthy();
  expect(view.getByText("2 requests, 2 runs, 1 error")).toBeTruthy();
  expect(
    view.getAllByRole("progressbar")[0]?.getAttribute("aria-valuenow"),
  ).toBe("65");
});

test("ExplorerSyncLanesPanelView opens lane details from the responsive list", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      phase: "document",
    }),
  ]);
  const openedLaneKeys: string[] = [];

  const view = renderSyncLanesPanel({
    onOpenLaneDetail: (laneKey) => {
      openedLaneKeys.push(laneKey);
    },
    snapshot,
  });

  fireEvent.click(
    view.getByRole("button", {
      name: "Open lane detail: Document local-1",
    }),
  );

  expect(openedLaneKeys).toEqual(["documents:local-1"]);
});

test("ExplorerSyncLanesPanelView trims the list to lane and status on phones", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      lastAction: "started",
      phase: "document",
      requestCount: 1,
      runCount: 1,
      running: true,
      status: "running",
    }),
  ]);

  const view = renderSyncLanesPanelOnPhone({ snapshot });

  const headerCells = Array.from(view.container.querySelectorAll("thead th"));
  expect(headerCells.map((cell) => cell.textContent)).toEqual([
    "Lane",
    "Status",
  ]);
  // The lane stays identifiable by its compact category label and the status
  // still reads at a glance...
  expect(view.getByText("Document")).toBeTruthy();
  expect(view.getAllByText("Running").length).toBeGreaterThan(0);
  // ...while the wide-only detail columns and their column menu fall away.
  expect(view.queryByText("1 request, 1 run, 0 errors")).toBeNull();
  expect(view.queryByRole("progressbar")).toBeNull();
  expect(view.queryByRole("button", { name: "Columns" })).toBeNull();
  // Lane + status only, with the lane column flexing, so no width floor applies.
  const table = view.getByRole("table", { name: "Sync Lanes" }) as HTMLElement;
  expect(table.style.minWidth).toBe("");
});

test("ExplorerSyncLanesPanelView opens lane details from the compact list", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      phase: "document",
    }),
  ]);
  const openedLaneKeys: string[] = [];

  const view = renderSyncLanesPanelOnPhone({
    onOpenLaneDetail: (laneKey) => {
      openedLaneKeys.push(laneKey);
    },
    snapshot,
  });

  fireEvent.click(
    view.getByRole("button", {
      name: "Open lane detail: Document local-1",
    }),
  );

  expect(openedLaneKeys).toEqual(["documents:local-1"]);
});

test("ExplorerSyncLanesPanelView opens lane details from a tap on the row body", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      phase: "document",
      status: "running",
    }),
  ]);
  const openedLaneKeys: string[] = [];

  const view = renderSyncLanesPanelOnPhone({
    onOpenLaneDetail: (laneKey) => {
      openedLaneKeys.push(laneKey);
    },
    snapshot,
  });

  // Tapping a non-interactive part of the row (the status cell, outside the lane
  // button) still opens the lane. The row's JS onActivate handler owns the hit
  // area instead of a full-row overlay button, so iOS keeps its scroll gesture.
  const statusCell = view.container.querySelector(
    ".explorer-sync-lane-table-row .mini-app-table-cell:last-child",
  );
  if (!(statusCell instanceof HTMLElement)) {
    throw new Error("Expected a status cell in the sync lane row.");
  }
  fireEvent.click(statusCell);

  expect(openedLaneKeys).toEqual(["documents:local-1"]);
});

test("ExplorerSyncLanesPanelView places the column menu in the rightmost status header", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      phase: "document",
      status: "running",
    }),
  ]);

  const view = renderSyncLanesPanel({ snapshot });
  const headerCells = Array.from(view.container.querySelectorAll("thead th"));
  const columnsButton = view.getByRole("button", { name: "Columns" });
  const table = view.getByRole("table", { name: "Sync Lanes" }) as HTMLElement;

  expect(headerCells.at(-1)?.textContent).toContain("Status");
  expect(headerCells.at(-1)?.contains(columnsButton)).toBe(true);
  // Inline floor = sum of visible columns' fixed rem widths (10+7+11+12+12+7+7).
  // Set explicitly, not via CSS `max-content` (which Firefox sizes from cell
  // content, blowing the columns out); hiding Progress drops its 11rem too.
  expect(table.style.minWidth).toBe("66rem");

  fireEvent.click(columnsButton);
  fireEvent.click(view.getByRole("checkbox", { name: /Progress/u }));

  expect(view.queryByRole("progressbar")).toBeNull();
  expect(table.style.minWidth).toBe("55rem");
});

test("ExplorerSyncLanesPanelView renders lane detail metadata", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      errorCount: 1,
      key: "documents:local-2",
      label: "Document local-2",
      lastAction: "failed",
      lastCompletedAt: "2026-06-15T12:02:00.000Z",
      lastError: "boom",
      lastFailedAt: "2026-06-15T12:03:00.000Z",
      lastRequestedAt: "2026-06-15T12:00:30.000Z",
      lastStartedAt: "2026-06-15T12:01:00.000Z",
      phase: "document",
      registrationIndex: 4,
      requestCount: 2,
      requested: true,
      runCount: 2,
      status: "error",
    }),
  ]);

  const view = renderSyncLanesPanel({
    selectedLaneKey: "documents:local-2",
    snapshot,
  });

  expect(view.getByText("Sync Lane Detail")).toBeTruthy();
  // The three sections are now tabs; each is a tab button, and the general tab
  // is active on open so its section content renders.
  expect(view.getByRole("tab", { name: "Lane Details" })).toBeTruthy();
  expect(view.getByRole("tab", { name: "Timing" })).toBeTruthy();
  expect(view.getByRole("tab", { name: "Coordinator" })).toBeTruthy();
  // This lane has no multipart progress, so no upload-progress tab.
  expect(view.queryByRole("tab", { name: "Upload Progress" })).toBeNull();
  expect(view.getByText("documents:local-2")).toBeTruthy();
  expect(view.getByText("4")).toBeTruthy();

  // Timing content lives behind its tab.
  fireEvent.click(view.getByRole("tab", { name: "Timing" }));
  expect(view.getByText("boom")).toBeTruthy();
  expect(view.queryByText("documents:local-2")).toBeNull();

  // Coordinator content lives behind its tab.
  fireEvent.click(view.getByRole("tab", { name: "Coordinator" }));
  expect(view.getByText("Pending Work")).toBeTruthy();
  expect(view.getByText("Pump Active")).toBeTruthy();
});

function createMultipartUploadSnapshot(): DomainSyncSnapshot {
  return createSnapshot([
    createLaneSnapshot({
      key: "blob-upload:slot-1",
      label: "Upload report.pdf",
      lastAction: "started",
      phase: "blob",
      progress: {
        bytesTotal: 40 * 1024 * 1024,
        bytesUploaded: 24 * 1024 * 1024,
        partsCompleted: 3,
        partsTotal: 5,
      },
      runCount: 1,
      running: true,
      status: "running",
    }),
  ]);
}

test("ExplorerSyncLanesPanelView renders real multipart upload progress", () => {
  const view = renderSyncLanesPanel({
    snapshot: createMultipartUploadSnapshot(),
  });

  // The list rolls the blob-upload lane up to its compact category label; the
  // attachment name stays in the lane detail.
  expect(view.getByText("Blob upload")).toBeTruthy();
  expect(view.queryByText("Upload report.pdf")).toBeNull();
  expect(view.getByText("Blob")).toBeTruthy();
  // 24 MiB of 40 MiB ≈ 60%, derived from bytes rather than the status fallback.
  expect(
    view.getAllByRole("progressbar")[0]?.getAttribute("aria-valuenow"),
  ).toBe("60");
  expect(view.getByText(/3\/5 parts/)).toBeTruthy();
});

test("ExplorerSyncLanesPanelView reveals the upload-progress tab only with multipart progress", () => {
  const view = renderSyncLanesPanel({
    selectedLaneKey: "blob-upload:slot-1",
    snapshot: createMultipartUploadSnapshot(),
  });

  fireEvent.click(view.getByRole("tab", { name: "Upload Progress" }));
  expect(view.getByText("24.0 MB / 40.0 MB")).toBeTruthy();
  expect(view.getByText("3 / 5")).toBeTruthy();
});

test("ExplorerSyncLanesPanelView renders the empty state", () => {
  const view = renderSyncLanesPanel({ snapshot: createSnapshot([]) });

  expect(view.getByText("No sync lanes.")).toBeTruthy();
});

test("getExplorerSyncLaneProgress maps lane statuses to determinate values", () => {
  expect(getExplorerSyncLaneProgress("idle")).toBe(0);
  expect(getExplorerSyncLaneProgress("queued")).toBe(25);
  expect(getExplorerSyncLaneProgress("running")).toBe(65);
  expect(getExplorerSyncLaneProgress("complete")).toBe(100);
  expect(getExplorerSyncLaneProgress("error")).toBe(100);
});
