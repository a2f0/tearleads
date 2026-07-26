import { expect, test } from "bun:test";
import type { PaneLogEntry } from "../../components/pane/log/PaneLog";
import type { SystemStatusSnapshot } from "../../components/pane/status/useSystemStatusSnapshot";
import {
  formatSystemMonitorReport,
  MAX_REPORT_LOG_ENTRIES,
} from "./systemMonitorReport";

const CAPTURED_AT = "2026-07-17T14:32:11.000Z";

function createStatus(
  overrides: Partial<SystemStatusSnapshot> = {},
): SystemStatusSnapshot {
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
    ...overrides,
  };
}

function createLogEntry(
  id: number,
  overrides: Partial<PaneLogEntry> = {},
): PaneLogEntry {
  return {
    id: String(id),
    level: "info",
    // Fixed epoch so the rendered clock time is stable regardless of when the
    // test runs; the exact wall time is asserted loosely below.
    timestamp: 0,
    message: `entry ${id}`,
    ...overrides,
  };
}

test("report includes every section a support ticket needs", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [
      { label: "Browser", value: "Chrome 141.0.0.0" },
      { label: "OS", value: "macOS 15.5" },
    ],
    logEntries: [createLogEntry(1)],
    status: createStatus(),
  });

  expect(report).toContain("# System Monitor Report");
  expect(report).toContain(`_Captured ${CAPTURED_AT}_`);
  expect(report).toContain("## Environment");
  expect(report).toContain("| Browser | Chrome 141.0.0.0 |");
  expect(report).toContain("| OS | macOS 15.5 |");
  expect(report).toContain("## Status");
  expect(report).toContain("| SQLite Worker | ready |");
  expect(report).toContain("| Web Socket | connected |");
  expect(report).toContain("## Logs");
  expect(report).not.toContain("entry 1");
  expect(report).toContain(
    "_Omitted 1 free-form log entry to protect decrypted customer data._",
  );
});

test("copied telemetry logs retain subsecond precision", () => {
  const timestamp = new Date(2026, 0, 2, 3, 4, 5, 6).getTime();
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [
      createLogEntry(1, {
        message: "interest baseline containers=2",
        timestamp,
      }),
    ],
    status: createStatus(),
  });

  expect(report).toMatch(
    /\[\d{2}:\d{2}:\d{2}\.006\] interest baseline containers=2/u,
  );
});

test("report omits the feature flags section outside developer mode", () => {
  const base = {
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
  };

  expect(formatSystemMonitorReport(base)).not.toContain("## Feature Flags");
  expect(
    formatSystemMonitorReport({
      ...base,
      featureFlags: [{ label: "Built-in system containers", value: "Enabled" }],
    }),
  ).toContain("| Built-in system containers | Enabled |");
});

test("report drops the peer user id row when the feature is off", () => {
  const withoutPeer = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus({ peerUserId: null }),
  });
  expect(withoutPeer).not.toContain("Peer User ID");

  const withPeer = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus({ peerUserId: "peer-9" }),
  });
  expect(withPeer).toContain("| Peer User ID | peer-9 |");
});

test("report copies only the event count, never caller-controlled labels", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus({
      events: [
        { id: "1", label: "PRIVATE cardiology scan.pdf" },
        { id: "2", label: "document_update_created" },
      ],
    }),
  });

  expect(report).toContain("| Events | 2 events |");
  expect(report).not.toContain("PRIVATE cardiology scan.pdf");
  expect(report).not.toContain("document_update_created");
});

test("report escapes pipes so a value cannot break out of its table cell", () => {
  // A user-agent or event payload containing "|" would otherwise split the row
  // into extra columns and silently corrupt the table.
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [{ label: "User Agent", value: "Weird/1.0 (a|b)" }],
    logEntries: [],
    status: createStatus(),
  });

  expect(report).toContain("| User Agent | Weird/1.0 (a\\|b) |");
});

test("report collapses newlines that would otherwise end a table row early", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [{ label: "Note", value: "line one\nline two" }],
    logEntries: [],
    status: createStatus(),
  });

  expect(report).toContain("| Note | line one line two |");
});

test("report retains only anchored content-free telemetry", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [
      createLogEntry(1, { message: "PRIVATE cardiology scan.pdf" }),
      createLogEntry(2, {
        level: "error",
        message:
          "PRIVATE prefix: document priming candidates=4 roots=1 primed=3 unroutable=1",
      }),
      createLogEntry(3, {
        message:
          "Container contents: document priming candidates=4 roots=1 primed=3 unroutable=1 title=PRIVATE cardiology scan.pdf",
      }),
      createLogEntry(4, {
        message:
          "Container contents: stale root recovery status=reassigned candidates=1",
      }),
      createLogEntry(5, {
        message:
          "Container contents: stale root recovery status=already-adopted candidates=1",
      }),
      createLogEntry(6, {
        message:
          "Container contents: stale root recovery status=ambiguous candidates=2",
      }),
      createLogEntry(7, {
        message:
          "Container contents: stale root recovery status=context-changed candidates=1 occurrences=2",
      }),
      createLogEntry(8, {
        message:
          "Container contents: stale root recovery status=unsupported candidates=1",
      }),
      createLogEntry(9, {
        message: "Documents: remote revalidation scheduled reason=startup",
      }),
      createLogEntry(10, {
        message:
          "Documents: remote revalidation result=applied incomingUpdates=2 attachmentSlots=1",
      }),
      createLogEntry(11, {
        message: "Documents: remote revalidation result=unavailable",
      }),
      createLogEntry(12, {
        message: "WebSocket: interest baseline containers=12",
      }),
      createLogEntry(13, {
        message: "WebSocket: interest declaration acknowledged",
      }),
      createLogEntry(14, {
        message:
          "Documents: remote revalidation scheduled reason=reconnect PRIVATE cardiology scan.pdf",
      }),
    ],
    status: createStatus(),
  });

  expect(report).toContain(
    "ERROR: document priming candidates=4 roots=1 primed=3 unroutable=1",
  );
  expect(report).not.toContain("PRIVATE");
  expect(report).toContain(
    "stale root recovery status=reassigned candidates=1",
  );
  expect(report).toContain(
    "stale root recovery status=already-adopted candidates=1",
  );
  expect(report).toContain("stale root recovery status=ambiguous candidates=2");
  expect(report).toContain(
    "stale root recovery status=context-changed candidates=1 occurrences=2",
  );
  expect(report).toContain(
    "stale root recovery status=unsupported candidates=1",
  );
  expect(report).toContain("remote revalidation scheduled reason=startup");
  expect(report).toContain(
    "remote revalidation result=applied incomingUpdates=2 attachmentSlots=1",
  );
  expect(report).toContain("remote revalidation result=unavailable");
  expect(report).toContain("interest baseline containers=12");
  expect(report).toContain("interest declaration acknowledged");
  expect(report).toContain(
    "_Omitted 3 free-form log entries to protect decrypted customer data._",
  );
});

test("report retains document sync trace lines and drops decorated ones", () => {
  const documentId = "71ed8e12-fd1d-41fe-9c75-6c3a45b653e3";
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [
      createLogEntry(1, {
        message: `Documents: document sync stale bundle document=${documentId} epoch=1 pending=3`,
      }),
      createLogEntry(2, {
        message: `Documents: document sync heal planned document=${documentId} fromEpoch=1 toEpoch=2 updates=3 heldBack=0`,
      }),
      createLogEntry(3, {
        message: `Documents: document sync heal blocked document=${documentId} reason=snapshot-unavailable`,
      }),
      createLogEntry(4, {
        message: `Documents: document sync submit failed document=${documentId} status=409 code=document_sync_state_stale action=retry`,
      }),
      createLogEntry(5, {
        message: `Documents: document sync projection failed document=${documentId} status=none code=document_projection_container_conflict`,
      }),
      createLogEntry(6, {
        message: `Documents: document sync healed document=${documentId} epoch=2 accepted=4`,
      }),
      createLogEntry(7, {
        message: `Container contents: document sync stale read document=${documentId} epoch=1`,
      }),
      createLogEntry(8, {
        message: `Documents: document sync checkpoint regeneration document=${documentId} checkpoints=1 updates=2`,
      }),
      // A trace-shaped line with free-form decoration must still fail closed.
      createLogEntry(9, {
        message: `Documents: document sync healed document=${documentId} epoch=2 accepted=4 title=PRIVATE cardiology scan.pdf`,
      }),
      // Smuggled tokens inside the enumerated slots must fail closed too —
      // the pattern enumerates the emitted vocabulary rather than accepting
      // anything token-shaped.
      createLogEntry(10, {
        message: `Documents: document sync submit failed document=${documentId} status=409 code=private_patient_field action=stop`,
      }),
    ],
    status: createStatus(),
  });

  expect(report).toContain(
    `document sync stale bundle document=${documentId} epoch=1 pending=3`,
  );
  expect(report).toContain(
    `document sync heal planned document=${documentId} fromEpoch=1 toEpoch=2 updates=3 heldBack=0`,
  );
  expect(report).toContain(
    `document sync heal blocked document=${documentId} reason=snapshot-unavailable`,
  );
  expect(report).toContain(
    `document sync submit failed document=${documentId} status=409 code=document_sync_state_stale action=retry`,
  );
  expect(report).toContain(
    `document sync projection failed document=${documentId} status=none code=document_projection_container_conflict`,
  );
  expect(report).toContain(
    `document sync healed document=${documentId} epoch=2 accepted=4`,
  );
  expect(report).toContain(
    `document sync stale read document=${documentId} epoch=1`,
  );
  expect(report).toContain(
    `document sync checkpoint regeneration document=${documentId} checkpoints=1 updates=2`,
  );
  expect(report).not.toContain("PRIVATE");
  expect(report).not.toContain("private_patient_field");
  expect(report).toContain(
    "_Omitted 2 free-form log entries to protect decrypted customer data._",
  );
});

test("report caps content-free telemetry after filtering", () => {
  const logEntries = Array.from(
    { length: MAX_REPORT_LOG_ENTRIES + 50 },
    (_, i) =>
      createLogEntry(i, {
        message: `Container contents: document priming candidates=${i} roots=1 primed=1 unroutable=0`,
      }),
  );
  logEntries.unshift(
    createLogEntry(-1, { message: "PRIVATE cardiology scan.pdf" }),
  );

  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries,
    status: createStatus(),
  });

  expect(report).toContain(
    `_Showing the last ${MAX_REPORT_LOG_ENTRIES} of ${logEntries.length - 1} content-free telemetry entries._`,
  );
  // The newest entries survive; the oldest are the ones dropped.
  expect(report).toContain(
    `document priming candidates=${logEntries.length - 2} roots=1`,
  );
  expect(report).not.toContain("document priming candidates=0 roots=1");
  expect(report).not.toContain("PRIVATE");
});

test("report leaves uncapped content-free telemetry unannotated", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [
      createLogEntry(1, {
        message:
          "Container contents: document priming candidates=1 roots=1 primed=1 unroutable=0",
      }),
      createLogEntry(2, {
        message:
          "Container contents: document priming candidates=2 roots=1 primed=2 unroutable=0",
      }),
    ],
    status: createStatus(),
  });

  expect(report).not.toContain("Showing the last");
  expect(report).toContain("```text");
});

test("report states when no content-free telemetry is available", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
  });

  expect(report).toContain("_No content-free telemetry entries._");
  expect(report).not.toContain("```text");
});

test("report omits arbitrary multiline and fenced log content", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [
      createLogEntry(1, {
        message: "PRIVATE before\n```\ncardiology scan.pdf",
      }),
    ],
    status: createStatus(),
  });

  expect(report).not.toContain("PRIVATE");
  expect(report).not.toContain("cardiology scan.pdf");
  expect(report).not.toContain("```text");
});
