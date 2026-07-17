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
  expect(report).toContain("entry 1");
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
      featureFlags: [{ label: "Passkeys", value: "Enabled" }],
    }),
  ).toContain("| Passkeys | Enabled |");
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

test("report flattens the event list into its cell", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus({
      events: [
        { id: "1", label: "user.created (u1)" },
        { id: "2", label: "doc.updated" },
      ],
    }),
  });

  expect(report).toContain("| Events | user.created (u1), doc.updated |");
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

test("report marks an error log line the way the Logs tab does", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [createLogEntry(1, { level: "error", message: "boom" })],
    status: createStatus(),
  });

  expect(report).toContain("ERROR: boom");
});

test("report caps the log and says so rather than truncating silently", () => {
  const logEntries = Array.from(
    { length: MAX_REPORT_LOG_ENTRIES + 50 },
    (_, i) => createLogEntry(i),
  );

  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries,
    status: createStatus(),
  });

  expect(report).toContain(
    `_Showing the last ${MAX_REPORT_LOG_ENTRIES} of ${logEntries.length} entries._`,
  );
  // The newest entries survive; the oldest are the ones dropped.
  expect(report).toContain(`entry ${logEntries.length - 1}`);
  expect(report).not.toContain("entry 0\n");
});

test("report leaves an uncapped log unannotated", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [createLogEntry(1), createLogEntry(2)],
    status: createStatus(),
  });

  expect(report).not.toContain("Showing the last");
  expect(report).toContain("```text");
});

test("report states an empty log instead of emitting a blank code fence", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [],
    status: createStatus(),
  });

  expect(report).toContain("_No log entries._");
  expect(report).not.toContain("```text");
});

test("report widens the log fence so a backtick line cannot close it early", () => {
  // A multiline log message (e.g. an error's stack trace) containing a line of
  // three backticks would otherwise close the ```text fence and spill the rest
  // of the log into rendered Markdown.
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [
      createLogEntry(1, { message: "before\n```\nafter" }),
      createLogEntry(2, { message: "tail" }),
    ],
    status: createStatus(),
  });

  // The fence is one backtick longer than the content's longest run, so it
  // opens with ````text and closes with ````.
  expect(report).toContain("````text");
  expect(report).toContain("\n````\n");
  // The embedded ``` is quoted content, not a closing fence, so the later entry
  // stays inside the block.
  expect(report).toContain("tail");
  const openIndex = report.indexOf("````text");
  const tailIndex = report.indexOf("tail");
  const closeIndex = report.indexOf("\n````\n");
  expect(openIndex).toBeLessThan(tailIndex);
  expect(tailIndex).toBeLessThan(closeIndex);
});

test("report escalates the fence past longer backtick runs too", () => {
  const report = formatSystemMonitorReport({
    capturedAt: CAPTURED_AT,
    environment: [],
    logEntries: [createLogEntry(1, { message: "````` five" })],
    status: createStatus(),
  });

  // Longest run is five backticks, so the fence must be at least six.
  expect(report).toContain("``````text");
});
