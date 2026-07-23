import { expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import type { SystemStatusSnapshot } from "../../components/pane/status/useSystemStatusSnapshot";
import {
  formatSystemMonitorReport,
  MAX_REPORT_WRITE_QUEUE_ITEMS,
} from "./systemMonitorReport";

const CAPTURED_AT = "2026-07-17T14:32:11.000Z";

// The write-queue and sync-lane sections do not read the status, so a minimal
// valid snapshot is enough for these cases; the status rendering itself is
// covered in systemMonitorReport.test.ts.
function createStatus(): SystemStatusSnapshot {
  return {
    events: [],
    id: "db-1",
    network: "online",
    peerUserId: null,
    publicKey: "fp-abc",
    session: "tok123...",
    sqliteWorker: "ready",
    userId: "user-1",
    ws: "connected",
  };
}

function createOperation(
  overrides: Partial<PendingWriteQueueOperation> = {},
): PendingWriteQueueOperation {
  return {
    byteLength: 0,
    count: 1,
    createdAt: null,
    kind: "update",
    lastAttemptedAt: null,
    lastError: null,
    status: "pending",
    targetContainerId: null,
    updatedAt: null,
    ...overrides,
  };
}

function createWriteItem(
  overrides: Partial<PendingWriteQueueItem> = {},
): PendingWriteQueueItem {
  return {
    containerId: "container-1",
    createdAt: "2026-07-17T10:00:00.000Z",
    localId: "local-1",
    name: "Quarterly Plan",
    namespace: null,
    objectKind: "document",
    operations: [createOperation()],
    organizationId: "org-1",
    remoteId: "remote-1",
    status: "pending",
    updatedAt: "2026-07-17T11:00:00.000Z",
    ...overrides,
  };
}

function createLane(
  overrides: Partial<SyncLaneSnapshot> = {},
): SyncLaneSnapshot {
  return {
    blobStorageKey: null,
    errorCount: 0,
    key: "structural:org-1",
    label: "Structural sync",
    lastAction: "completed",
    lastActionAt: "2026-07-17T12:00:00.000Z",
    lastCompletedAt: "2026-07-17T12:00:00.000Z",
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: "2026-07-17T11:59:00.000Z",
    lastStartedAt: "2026-07-17T11:59:30.000Z",
    phase: "structural",
    progress: null,
    registrationIndex: 0,
    requestCount: 3,
    requested: false,
    runCount: 3,
    running: false,
    status: "complete",
    ...overrides,
  };
}

function createSyncSnapshot(
  overrides: Partial<DomainSyncSnapshot> = {},
): DomainSyncSnapshot {
  return {
    hasPendingWork: false,
    lanes: [],
    pumpActive: false,
    updatedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

test("report omits the queue sections when the caller does not gather them", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
  });

  expect(report).not.toContain("## Write Queue");
  expect(report).not.toContain("## Sync Lanes");
});

test("report serializes write-queue item and operation detail", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    writeQueue: {
      available: true,
      items: [
        createWriteItem({
          status: "error",
          operations: [
            createOperation({
              byteLength: 2048,
              count: 4,
              kind: "attachment",
              lastAttemptedAt: "2026-07-17T11:30:00.000Z",
              lastError: "upload rejected",
              status: "blocked",
            }),
          ],
        }),
      ],
    },
  });

  expect(report).toContain("## Write Queue");
  expect(report).toContain(
    "_1 queued object(s), 4 pending write operation(s)._",
  );
  expect(report).toContain("### Quarterly Plan");
  expect(report).toContain("| Status | error |");
  expect(report).toContain("| Local ID | local-1 |");
  expect(report).toContain("| Organization ID | org-1 |");
  // Operation row surfaces the failure detail support needs.
  expect(report).toContain(
    "| attachment | blocked | 4 | 2048 | - | - | 2026-07-17T11:30:00.000Z | - | upload rejected |",
  );
});

test("report falls back to the local id when a queued object is unnamed", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    writeQueue: {
      available: true,
      items: [createWriteItem({ name: null, localId: "local-42" })],
    },
  });

  expect(report).toContain("### local-42");
});

test("report escapes a pipe in a queued operation's error", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    writeQueue: {
      available: true,
      items: [
        createWriteItem({
          operations: [createOperation({ lastError: "429 | rate limited" })],
        }),
      ],
    },
  });

  expect(report).toContain("429 \\| rate limited");
});

test("report distinguishes an unavailable write queue from an empty one", () => {
  const unavailable = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    writeQueue: { available: false, items: [] },
  });
  expect(unavailable).toContain(
    "_The local database is not ready, so the write queue is unavailable._",
  );

  const empty = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    writeQueue: { available: true, items: [] },
  });
  expect(empty).toContain("_No pending writes._");
});

test("report caps the write queue and says so rather than truncating silently", () => {
  const items = Array.from(
    { length: MAX_REPORT_WRITE_QUEUE_ITEMS + 5 },
    // Unnamed so the heading falls back to the (unique) local id, letting the
    // assertions below tell the surviving items from the dropped ones.
    (_, index) => createWriteItem({ name: null, localId: `local-${index}` }),
  );

  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    writeQueue: { available: true, items },
  });

  expect(report).toContain(
    `_Showing the first ${MAX_REPORT_WRITE_QUEUE_ITEMS} of ${items.length} queued objects._`,
  );
  // The first items survive; the ones past the cap are dropped.
  expect(report).toContain("### local-0");
  expect(report).not.toContain(`### local-${MAX_REPORT_WRITE_QUEUE_ITEMS}`);
});

test("report serializes sync-lane detail including failures", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    syncLanes: createSyncSnapshot({
      hasPendingWork: true,
      lanes: [
        createLane({
          blobStorageKey: "blob-key-1",
          errorCount: 2,
          label: "Blob upload",
          lastError: "network unreachable",
          lastFailedAt: "2026-07-17T12:01:00.000Z",
          phase: "blob",
          progress: {
            bytesTotal: 100,
            bytesUploaded: 10,
            partsCompleted: 1,
            partsTotal: 4,
          },
          status: "error",
        }),
      ],
    }),
  });

  expect(report).toContain("## Sync Lanes");
  expect(report).toContain("| Pending Work | yes |");
  expect(report).toContain("### Blob upload");
  expect(report).toContain("| Status | error |");
  expect(report).toContain("| Last Error | network unreachable |");
  expect(report).toContain("| Error Count | 2 |");
  expect(report).toContain("| Progress | 10 / 100 bytes, 1 / 4 parts |");
  expect(report).toContain("| Blob Storage Key | blob-key-1 |");
});

test("report distinguishes unavailable sync lanes from an empty coordinator", () => {
  const unavailable = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    syncLanes: null,
  });
  expect(unavailable).toContain(
    "_The local database is not ready, so sync lanes are unavailable._",
  );

  const empty = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    syncLanes: createSyncSnapshot(),
  });
  expect(empty).toContain("_No active sync lanes._");
});
