import { afterEach, expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import {
  ExplorerSyncLanesPanelView,
  getExplorerSyncLaneProgress,
} from "./ExplorerSyncLanesPanel";

afterEach(() => cleanup());

const updatedAt = "2026-06-15T12:00:00.000Z";

function createLaneSnapshot(
  overrides: Partial<SyncLaneSnapshot>,
): SyncLaneSnapshot {
  return {
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
    registrationIndex: 0,
    requestCount: 0,
    requested: false,
    runCount: 0,
    running: false,
    status: "idle",
    ...overrides,
  };
}

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

  const view = render(
    createElement(ExplorerSyncLanesPanelView, {
      onBackToSelectionRoute: () => undefined,
      snapshot,
    }),
  );

  expect(view.getByText("Sync Lanes")).toBeTruthy();
  expect(view.getByText("Document local-1")).toBeTruthy();
  expect(view.getByText("Document local-2")).toBeTruthy();
  expect(view.getAllByText("Running").length).toBeGreaterThan(0);
  expect(view.getAllByText("Error").length).toBeGreaterThan(0);
  expect(view.getByText("1 request, 1 run, 0 errors")).toBeTruthy();
  expect(view.getByText("2 requests, 2 runs, 1 error")).toBeTruthy();
  expect(
    view.getAllByRole("progressbar")[0]?.getAttribute("aria-valuenow"),
  ).toBe("65");
});

test("ExplorerSyncLanesPanelView renders the empty state", () => {
  const view = render(
    createElement(ExplorerSyncLanesPanelView, {
      onBackToSelectionRoute: () => undefined,
      snapshot: createSnapshot([]),
    }),
  );

  expect(view.getByText("No sync lanes.")).toBeTruthy();
});

test("getExplorerSyncLaneProgress maps lane statuses to determinate values", () => {
  expect(getExplorerSyncLaneProgress("idle")).toBe(0);
  expect(getExplorerSyncLaneProgress("queued")).toBe(25);
  expect(getExplorerSyncLaneProgress("running")).toBe(65);
  expect(getExplorerSyncLaneProgress("complete")).toBe(100);
  expect(getExplorerSyncLaneProgress("error")).toBe(100);
});
