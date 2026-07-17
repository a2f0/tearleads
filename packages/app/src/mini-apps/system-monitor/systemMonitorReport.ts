import {
  formatPaneLogLine,
  type PaneLogEntry,
} from "../../components/pane/log/PaneLog";
import {
  NO_STATUS_VALUE,
  STATUS_LABELS,
  type SystemStatusSnapshot,
} from "../../components/pane/status/useSystemStatusSnapshot";
import type { EnvironmentRow } from "./useSystemEnvironment";

/**
 * Serializes the System Monitor into a Markdown support report.
 *
 * Markdown because the destination is a support ticket or issue tracker, where
 * it renders as tables and still reads fine as raw text if it does not.
 *
 * Pure, and takes `capturedAt` rather than reading the clock, so the output is
 * fully determined by its inputs and can be asserted verbatim.
 */

export interface SystemMonitorReportFlag {
  readonly label: string;
  readonly value: string;
}

interface SystemMonitorReportInput {
  readonly capturedAt: string;
  readonly environment: ReadonlyArray<EnvironmentRow>;
  /** Developer-mode only; omitted entirely when the tab is not available. */
  readonly featureFlags?: ReadonlyArray<SystemMonitorReportFlag> | undefined;
  readonly logEntries: ReadonlyArray<PaneLogEntry>;
  readonly status: SystemStatusSnapshot;
}

/**
 * The log is capped so a report stays pasteable; the provider retains up to
 * 1000 entries, and the newest are the ones that explain a live problem. A
 * truncated report says so rather than looking complete.
 */
export const MAX_REPORT_LOG_ENTRIES = 200;

/**
 * Escapes a value for a Markdown table cell. A stray `|` would otherwise split
 * a cell into two and silently corrupt the row.
 */
function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatTable(
  headers: readonly [string, string],
  rows: ReadonlyArray<readonly [string, string]>,
): string {
  const lines = [
    `| ${headers[0]} | ${headers[1]} |`,
    "| --- | --- |",
    ...rows.map(
      ([label, value]) =>
        `| ${escapeTableCell(label)} | ${escapeTableCell(value)} |`,
    ),
  ];
  return lines.join("\n");
}

function formatStatusRows(
  status: SystemStatusSnapshot,
): ReadonlyArray<readonly [string, string]> {
  const rows: Array<readonly [string, string]> = [
    [STATUS_LABELS.sqliteWorker, status.sqliteWorker],
    [STATUS_LABELS.id, status.id],
    [STATUS_LABELS.publicKey, status.publicKey],
    [STATUS_LABELS.userId, status.userId],
  ];

  // Mirrors the Status tab, which drops the row entirely when peer user IDs are
  // disabled rather than showing an empty one.
  if (status.peerUserId !== null) {
    rows.push([STATUS_LABELS.peerUserId, status.peerUserId]);
  }

  rows.push(
    [STATUS_LABELS.session, status.session],
    [STATUS_LABELS.network, status.network],
    [STATUS_LABELS.ws, status.ws],
    [
      STATUS_LABELS.events,
      status.events.length === 0
        ? NO_STATUS_VALUE
        : status.events.map((event) => event.label).join(", "),
    ],
  );

  return rows;
}

/**
 * Chooses a code-fence length that the content cannot close early.
 *
 * A log message can be multiline (an error's `String(cause)` may carry a stack
 * trace), so a line of three-or-more backticks inside it would terminate a fixed
 * ```` ``` ```` fence and spill the rest of the log into rendered Markdown. Per
 * CommonMark, a fence of N backticks is closed only by a run of N or more, so a
 * fence one longer than the content's longest backtick run stays intact.
 */
function fenceForContent(content: string): string {
  let longestRun = 0;
  for (const match of content.matchAll(/`+/gu)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  return "`".repeat(Math.max(3, longestRun + 1));
}

function formatLogSection(
  logEntries: ReadonlyArray<PaneLogEntry>,
): ReadonlyArray<string> {
  if (logEntries.length === 0) {
    return ["## Logs", "", "_No log entries._"];
  }

  const visible = logEntries.slice(-MAX_REPORT_LOG_ENTRIES);
  const truncationNote =
    visible.length < logEntries.length
      ? [
          `_Showing the last ${visible.length} of ${logEntries.length} entries._`,
          "",
        ]
      : [];

  const lines = visible.map(formatPaneLogLine);
  const fence = fenceForContent(lines.join("\n"));

  return ["## Logs", "", ...truncationNote, `${fence}text`, ...lines, fence];
}

export function formatSystemMonitorReport(
  input: SystemMonitorReportInput,
): string {
  const sections: string[] = [
    "# System Monitor Report",
    "",
    `_Captured ${input.capturedAt}_`,
    "",
    "## Environment",
    "",
    formatTable(
      ["Field", "Value"],
      input.environment.map((row) => [row.label, row.value] as const),
    ),
    "",
    "## Status",
    "",
    formatTable(["Field", "Value"], formatStatusRows(input.status)),
    "",
  ];

  if (input.featureFlags && input.featureFlags.length > 0) {
    sections.push(
      "## Feature Flags",
      "",
      formatTable(
        ["Flag", "State"],
        input.featureFlags.map((flag) => [flag.label, flag.value] as const),
      ),
      "",
    );
  }

  sections.push(...formatLogSection(input.logEntries), "");

  return sections.join("\n");
}
