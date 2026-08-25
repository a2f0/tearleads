import { expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
  SyncLaneSnapshot,
} from "@symcrypt/client-sdk";
import type { SystemStatusSnapshot } from "../../../components/pane/status/useSystemStatusSnapshot";
import {
  formatSystemMonitorReport,
  MAX_REPORT_WRITE_QUEUE_ITEMS,
} from "./systemMonitorReport";

const CAPTURED_AT = "2026-07-17T14:32:11.000Z";
const LOCAL_ID = "11111111-1111-4111-8111-111111111111";
const REMOTE_ID = "22222222-2222-4222-8222-222222222222";
const CONTAINER_ID = "33333333-3333-4333-8333-333333333333";
const ORGANIZATION_ID = "44444444-4444-4444-8444-444444444444";

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
    containerId: CONTAINER_ID,
    createdAt: "2026-07-17T10:00:00.000Z",
    localId: LOCAL_ID,
    name: "Quarterly Plan",
    namespace: null,
    objectKind: "document",
    operations: [createOperation()],
    organizationId: ORGANIZATION_ID,
    remoteId: REMOTE_ID,
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
    runAbandoned: false,
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
  expect(report).toContain(`### document ${LOCAL_ID}`);
  expect(report).not.toContain("Quarterly Plan");
  expect(report).toContain("| Status | error |");
  expect(report).toContain(`| Local ID | ${LOCAL_ID} |`);
  expect(report).toContain(`| Organization ID | ${ORGANIZATION_ID} |`);
  expect(report).not.toContain("upload rejected");
  expect(report).toContain(
    "| attachment | blocked | 4 | 2048 | - | - | 2026-07-17T11:30:00.000Z | - | [redacted] |",
  );
});

test("report identifies unnamed queued objects by opaque id", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    writeQueue: {
      available: true,
      items: [createWriteItem({ name: null })],
    },
  });

  expect(report).toContain(`### document ${LOCAL_ID}`);
});

test("report redacts caller-controlled queue identifiers and namespaces", () => {
  const privateText = "PRIVATE cardiology scan.pdf";
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    writeQueue: {
      available: true,
      items: [
        createWriteItem({
          containerId: `${privateText} container`,
          localId: `${privateText}\r\nheading`,
          namespace: `${privateText} namespace`,
          operations: [
            createOperation({ targetContainerId: `${privateText} target` }),
          ],
          organizationId: `${privateText} organization`,
          remoteId: `${privateText} remote`,
        }),
      ],
    },
  });

  expect(report).not.toContain(privateText);
  expect(report).toContain("### document [redacted]");
  expect(report).toContain("| Namespace | [redacted] |");
  expect(report).toContain("| Local ID | [redacted] |");
  expect(report).toContain(
    "| update | pending | 1 | 0 | - | - | - | [redacted] | - |",
  );
});

test("report redacts a queued operation's free-text error", () => {
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

  expect(report).not.toContain("429 | rate limited");
  expect(report).toContain("| [redacted] |");
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
    (_, index) =>
      createWriteItem({
        name: null,
        localId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      }),
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
  expect(report).toContain("### document 00000000-0000-4000-8000-000000000000");
  expect(report).not.toContain(
    `### document 00000000-0000-4000-8000-${String(MAX_REPORT_WRITE_QUEUE_ITEMS).padStart(12, "0")}`,
  );
});

test("report serializes sync-lane state without free-text diagnostics", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
    syncLanes: createSyncSnapshot({
      hasPendingWork: true,
      lanes: [
        createLane({
          blobStorageKey: "PRIVATE cardiology scan.pdf storage key",
          errorCount: 2,
          label: "Upload PRIVATE cardiology scan.pdf",
          lastError: "Attachment upload failed for PRIVATE cardiology scan.pdf",
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
  expect(report).toContain("### blob lane 0");
  expect(report).not.toContain("PRIVATE cardiology scan.pdf");
  expect(report).toContain("| Status | error |");
  expect(report).toContain("| Last Error | [redacted] |");
  expect(report).toContain("| Error Count | 2 |");
  expect(report).toContain("| Progress | 10 / 100 bytes, 1 / 4 parts |");
  expect(report).toContain("| Blob Storage Key | [redacted] |");
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
