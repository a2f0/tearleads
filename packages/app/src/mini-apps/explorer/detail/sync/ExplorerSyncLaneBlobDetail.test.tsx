import { afterEach, expect, test } from "bun:test";
import type {
  DocumentSummary,
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
    runDurations: null,
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

test("blob lane Label and Key open the blob being uploaded", () => {
  const openedStorageKeys: string[] = [];
  const lane = createLane("documents/local-1/report.pdf");
  const view = render(
    <ExplorerSyncLanesPanelView
      onOpenBlobDetail={(storageKey) => openedStorageKeys.push(storageKey)}
      onOpenLaneDetail={() => undefined}
      selectedLaneKey={lane.key}
      snapshot={createSnapshot(lane)}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.syncLanesOpenBlobAction}: Upload report.pdf`,
    }),
  );
  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.syncLanesOpenBlobAction}: blob-upload:blob-1`,
    }),
  );

  expect(openedStorageKeys).toEqual([
    "documents/local-1/report.pdf",
    "documents/local-1/report.pdf",
  ]);
});

function renderDocumentLane(summary: DocumentSummary | null) {
  const opened: Array<{ containerId: string; localId: string }> = [];
  const loaded: string[] = [];
  const lane = createLane(null);
  const view = render(
    <ExplorerSyncLanesPanelView
      documentLinks={{
        loadDocumentSummary: async (localId) => {
          loaded.push(localId);
          return summary;
        },
        openDocument: (localId, containerId) =>
          opened.push({ containerId, localId }),
      }}
      onOpenLaneDetail={() => undefined}
      selectedLaneKey={lane.key}
      snapshot={createSnapshot(lane)}
    />,
  );
  return { loaded, opened, view };
}

test("document lane Label and Key open the document being synced", async () => {
  const { loaded, opened, view } = renderDocumentLane({
    containerId: "folder-1",
    id: "local-1",
  } as DocumentSummary);
  const open = `${EXPLORER_LABELS.syncLanesOpenDocumentAction}: `;

  fireEvent.click(
    await view.findByRole("button", { name: `${open}Document local-1` }),
  );
  fireEvent.click(
    view.getByRole("button", { name: `${open}documents:local-1` }),
  );

  expect(loaded).toEqual(["local-1"]);
  expect(opened).toEqual([
    { containerId: "folder-1", localId: "local-1" },
    { containerId: "folder-1", localId: "local-1" },
  ]);
});

test("a document lane without a shown document keeps plain text", async () => {
  // Unhydrated here, or orphaned: there is no folder to open it in.
  for (const summary of [
    null,
    { containerId: null, id: "local-1" } as DocumentSummary,
  ]) {
    const { loaded, view } = renderDocumentLane(summary);
    await waitFor(() => expect(loaded).toEqual(["local-1"]));
    expect(view.getAllByText("Document local-1").length).toBeGreaterThan(0);
    expect(
      view.queryByRole("button", {
        name: new RegExp(EXPLORER_LABELS.syncLanesOpenDocumentAction),
      }),
    ).toBeNull();
    cleanup();
  }
});
