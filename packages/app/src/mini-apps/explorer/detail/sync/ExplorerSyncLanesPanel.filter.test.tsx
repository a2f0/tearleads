import { afterEach, expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { ExplorerSyncLanesPanelView } from "./ExplorerSyncLanesPanel";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

const updatedAt = "2026-06-15T12:00:00.000Z";

function createLaneSnapshot(input: {
  key: string;
  status: SyncLaneStatus;
}): SyncLaneSnapshot {
  return {
    blobStorageKey: null,
    errorCount: input.status === "error" ? 1 : 0,
    key: input.key,
    label: `Document ${input.key}`,
    lastAction: "registered",
    lastActionAt: updatedAt,
    lastCompletedAt: null,
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: null,
    lastStartedAt: null,
    phase: "document",
    progress: null,
    registrationIndex: 0,
    requestCount: 0,
    requested: false,
    runCount: 0,
    running: input.status === "running",
    status: input.status,
  };
}

// Every counted status is represented, with a distinct per-status lane count, so
// the number of rows left in the list identifies which metric filtered it.
const MIXED_LANES: ReadonlyArray<SyncLaneSnapshot> = [
  createLaneSnapshot({ key: "documents:running-1", status: "running" }),
  createLaneSnapshot({ key: "documents:queued-1", status: "queued" }),
  createLaneSnapshot({ key: "documents:queued-2", status: "queued" }),
  createLaneSnapshot({ key: "documents:complete-1", status: "complete" }),
  createLaneSnapshot({ key: "documents:error-1", status: "error" }),
  createLaneSnapshot({ key: "documents:idle-1", status: "idle" }),
];

function createSnapshot(
  lanes: ReadonlyArray<SyncLaneSnapshot>,
): DomainSyncSnapshot {
  return {
    hasPendingWork: lanes.some((lane) => lane.requested || lane.running),
    lanes,
    pumpActive: lanes.some((lane) => lane.running),
    updatedAt,
  };
}

function createPanelElement(input: {
  selectedLaneKey?: string | null | undefined;
  snapshot: DomainSyncSnapshot;
}) {
  return createElement(ExplorerSyncLanesPanelView, {
    onBackToSelectionRoute: () => undefined,
    onOpenLaneDetail: () => undefined,
    selectedLaneKey: input.selectedLaneKey ?? null,
    snapshot: input.snapshot,
  });
}

function renderSyncLanesPanel(snapshot: DomainSyncSnapshot) {
  return render(createPanelElement({ snapshot }));
}

function getLaneRowCount(container: HTMLElement): number {
  return container.querySelectorAll(".explorer-sync-lane-table-row").length;
}

// Scoped to the rows: the same status words label the overview tiles above.
function getLaneRowStatuses(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(
      ".explorer-sync-lane-table-row .explorer-sync-lane-status",
    ),
  ).map((node) => node.textContent ?? "");
}

// The metric tiles are the only buttons in the overview; the status badges that
// repeat these words in the list below are plain spans, so the role narrows the
// match to the tile even where the label is not unique on the page.
function getMetricTile(
  view: ReturnType<typeof render>,
  label: RegExp,
): HTMLElement {
  return view.getByRole("button", { name: label });
}

test("ExplorerSyncLaneOverview counts each status and totals the registered lanes", () => {
  const view = renderSyncLanesPanel(createSnapshot(MIXED_LANES));

  expect(getMetricTile(view, /Registered/u).textContent).toBe("6Registered");
  expect(getMetricTile(view, /Queued/u).textContent).toBe("2Queued");
  expect(getMetricTile(view, /Errors/u).textContent).toBe("1Errors");
});

test("ExplorerSyncLaneOverview filters the list to the selected metric", () => {
  const view = renderSyncLanesPanel(createSnapshot(MIXED_LANES));

  expect(getLaneRowCount(view.container)).toBe(6);

  fireEvent.click(getMetricTile(view, /Queued/u));

  expect(getLaneRowStatuses(view.container)).toEqual(["Queued", "Queued"]);
});

test("ExplorerSyncLaneOverview marks the selected metric as pressed", () => {
  const view = renderSyncLanesPanel(createSnapshot(MIXED_LANES));
  const registered = getMetricTile(view, /Registered/u);
  const errors = getMetricTile(view, /Errors/u);

  // An unfiltered list is the Registered tile's own state, so it starts pressed.
  expect(registered.getAttribute("aria-pressed")).toBe("true");
  expect(errors.getAttribute("aria-pressed")).toBe("false");

  fireEvent.click(errors);

  expect(registered.getAttribute("aria-pressed")).toBe("false");
  expect(errors.getAttribute("aria-pressed")).toBe("true");
});

test("ExplorerSyncLaneOverview clears the filter when the active metric is reselected", () => {
  const view = renderSyncLanesPanel(createSnapshot(MIXED_LANES));
  const running = getMetricTile(view, /Running/u);

  fireEvent.click(running);
  expect(getLaneRowCount(view.container)).toBe(1);

  fireEvent.click(running);
  expect(getLaneRowCount(view.container)).toBe(6);
  expect(running.getAttribute("aria-pressed")).toBe("false");
});

test("ExplorerSyncLaneOverview clears the filter from the Registered metric", () => {
  const view = renderSyncLanesPanel(createSnapshot(MIXED_LANES));

  fireEvent.click(getMetricTile(view, /Complete/u));
  expect(getLaneRowCount(view.container)).toBe(1);

  fireEvent.click(getMetricTile(view, /Registered/u));
  expect(getLaneRowCount(view.container)).toBe(6);
});

test("ExplorerSyncLaneOverview distinguishes a filtered-empty list from no lanes", () => {
  const emptyView = renderSyncLanesPanel(createSnapshot([]));
  expect(emptyView.getByText("No sync lanes.")).toBeTruthy();
  cleanup();

  const view = renderSyncLanesPanel(
    createSnapshot([
      createLaneSnapshot({ key: "documents:running-1", status: "running" }),
    ]),
  );

  // A zero-count metric stays selectable rather than disabled, so selecting one
  // is never a one-way trip: the empty state names the filter as the reason, and
  // the tile stays pressed so it can be toggled back off.
  const errors = getMetricTile(view, /Errors/u);
  fireEvent.click(errors);

  expect(getLaneRowCount(view.container)).toBe(0);
  expect(view.getByText("No lanes match this filter.")).toBeTruthy();
  expect(view.queryByText("No sync lanes.")).toBeNull();
  expect(errors.getAttribute("aria-pressed")).toBe("true");
});

test("ExplorerSyncLaneOverview keeps the filter across a lane detail round trip", () => {
  const snapshot = createSnapshot(MIXED_LANES);
  const view = render(createPanelElement({ snapshot }));

  fireEvent.click(getMetricTile(view, /Queued/u));
  expect(getLaneRowCount(view.container)).toBe(2);

  view.rerender(
    createPanelElement({ selectedLaneKey: "documents:queued-1", snapshot }),
  );
  view.rerender(createPanelElement({ snapshot }));

  expect(getLaneRowCount(view.container)).toBe(2);
  expect(getMetricTile(view, /Queued/u).getAttribute("aria-pressed")).toBe(
    "true",
  );
});
