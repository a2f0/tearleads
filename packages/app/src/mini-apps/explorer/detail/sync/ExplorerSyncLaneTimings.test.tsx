import { afterEach, expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerSyncLanesPanelView } from "./ExplorerSyncLanesPanel";

afterEach(cleanup);

const updatedAt = "2026-10-20T12:00:00.000Z";

function createLane(overrides: Partial<SyncLaneSnapshot>): SyncLaneSnapshot {
  return {
    blobStorageKey: null,
    errorCount: 0,
    key: "documents:local-1",
    label: "Document local-1",
    lastAction: "completed",
    lastActionAt: updatedAt,
    lastCompletedAt: updatedAt,
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: updatedAt,
    lastStartedAt: updatedAt,
    phase: "document",
    progress: null,
    registrationIndex: 0,
    requestCount: 3,
    requested: false,
    runAbandoned: false,
    runCount: 3,
    runDurations: { count: 3, lastMs: 42.4, maxMs: 2_500, totalMs: 3_000 },
    running: false,
    status: "complete",
    ...overrides,
  };
}

function renderPanel(
  lanes: ReadonlyArray<SyncLaneSnapshot>,
  selectedLaneKey: string | null = null,
) {
  const snapshot: DomainSyncSnapshot = {
    hasPendingWork: false,
    lanes,
    pumpActive: false,
    updatedAt,
  };
  return render(
    <ExplorerSyncLanesPanelView
      onBackToSelectionRoute={() => undefined}
      onOpenLaneDetail={() => undefined}
      selectedLaneKey={selectedLaneKey}
      snapshot={snapshot}
    />,
  );
}

test("the lane list shows each lane's last run duration", () => {
  const view = renderPanel([
    createLane({}),
    createLane({
      key: "container-contents",
      label: "Container contents",
      lastAction: "registered",
      phase: "structural",
      runCount: 0,
      runDurations: null,
      status: "idle",
    }),
  ]);

  expect(
    view.getByRole("columnheader", {
      name: EXPLORER_LABELS.syncLanesLastRunColumn,
    }),
  ).toBeTruthy();
  const rows = view.getAllByRole("row").slice(1);
  expect(within(rows[0] ?? document.body).getByText("42 ms")).toBeTruthy();
  // A lane that has never settled a run shows a dash, not zero.
  expect(within(rows[1] ?? document.body).getByText("-")).toBeTruthy();
});

test("the lane detail Timing tab shows last, average, and max run durations", () => {
  const view = renderPanel([createLane({})], "documents:local-1");

  fireEvent.click(
    view.getByRole("tab", { name: EXPLORER_LABELS.syncLanesTimingHeading }),
  );

  const rowValue = (label: string) =>
    view.getByText(label).closest("tr")?.querySelector("td")?.textContent;
  expect(rowValue(EXPLORER_LABELS.syncLanesLastRunDurationRow)).toBe("42 ms");
  expect(rowValue(EXPLORER_LABELS.syncLanesAverageRunDurationRow)).toBe(
    "1.0 s",
  );
  expect(rowValue(EXPLORER_LABELS.syncLanesMaxRunDurationRow)).toBe("2.5 s");
});
