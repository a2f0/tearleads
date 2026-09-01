import { afterEach, expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerSyncLanesPanelView } from "./ExplorerSyncLanesPanel";

afterEach(cleanup);

const updatedAt = "2026-07-16T12:00:00.000Z";

function createLane(blobStorageKey: string | null): SyncLaneSnapshot {
  return {
    blobStorageKey,
    errorCount: 0,
    key: blobStorageKey ? "blob-upload:blob-1" : "documents:local-1",
    label: blobStorageKey ? "Upload report.pdf" : "Document local-1",
    lastAction: "completed",
    lastActionAt: updatedAt,
    lastCompletedAt: updatedAt,
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: updatedAt,
    lastStartedAt: updatedAt,
    phase: blobStorageKey ? "blob" : "document",
    progress: null,
    registrationIndex: 0,
    requestCount: 1,
    requested: false,
    runAbandoned: false,
    runCount: 1,
    running: false,
    status: "complete",
  };
}

function createSnapshot(lane: SyncLaneSnapshot): DomainSyncSnapshot {
  return {
    hasPendingWork: false,
    lanes: [lane],
    pumpActive: false,
    updatedAt,
  };
}

test("blob lane detail opens the matching Blob Browser storage key", () => {
  const openedStorageKeys: string[] = [];
  const lane = createLane("documents/local-1/report.pdf");
  const view = render(
    <ExplorerSyncLanesPanelView
      onBackToSelectionRoute={() => undefined}
      onOpenBlobDetail={(storageKey) => openedStorageKeys.push(storageKey)}
      onOpenLaneDetail={() => undefined}
      selectedLaneKey={lane.key}
      snapshot={createSnapshot(lane)}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.syncLanesOpenBlobAction,
    }),
  );

  expect(openedStorageKeys).toEqual(["documents/local-1/report.pdf"]);
});

test("non-blob lane detail omits the Blob Browser action", () => {
  const lane = createLane(null);
  const view = render(
    <ExplorerSyncLanesPanelView
      onBackToSelectionRoute={() => undefined}
      onOpenBlobDetail={() => undefined}
      onOpenLaneDetail={() => undefined}
      selectedLaneKey={lane.key}
      snapshot={createSnapshot(lane)}
    />,
  );

  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.syncLanesOpenBlobAction,
    }),
  ).toBeNull();
});
