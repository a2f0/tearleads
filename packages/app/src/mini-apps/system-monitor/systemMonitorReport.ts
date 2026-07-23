import type {
  DomainSyncSnapshot,
  PendingWriteQueueItem,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
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

/**
 * The durable write queue as the report sees it.
 *
 * `available` is false while the local database is still booting, so the report
 * can distinguish "the queue could not be read" from "the queue is empty". The
 * items are the SDK's already payload-free projection (`PendingWriteQueueItem`):
 * serialized Loro updates, storage keys, and encryption material are never part
 * of it, so serializing every field here cannot leak decrypted content.
 */
export interface SystemMonitorWriteQueueReport {
  readonly available: boolean;
  readonly items: ReadonlyArray<PendingWriteQueueItem>;
}

interface SystemMonitorReportInput {
  readonly capturedAt: string;
  readonly environment: ReadonlyArray<EnvironmentRow>;
  /** Developer-mode only; omitted entirely when the tab is not available. */
  readonly featureFlags?: ReadonlyArray<SystemMonitorReportFlag> | undefined;
  readonly logEntries: ReadonlyArray<PaneLogEntry>;
  readonly status: SystemStatusSnapshot;
  /**
   * Identity-wide durable write queue. Omitted entirely (`undefined`) when the
   * caller does not gather it; a present-but-unavailable value renders as such.
   */
  readonly writeQueue?: SystemMonitorWriteQueueReport | undefined;
  /**
   * The active domain scope's sync coordinator snapshot (lanes and failures).
   * `undefined` omits the section; `null` renders it as unavailable.
   */
  readonly syncLanes?: DomainSyncSnapshot | null | undefined;
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

function formatTableRow(cells: ReadonlyArray<string>): string {
  return `| ${cells.map(escapeTableCell).join(" | ")} |`;
}

function formatTable(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const lines = [
    formatTableRow(headers),
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(formatTableRow),
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

/**
 * Write-queue objects are capped like the log so a busy import (which can queue
 * hundreds of objects) keeps the report pasteable. A truncated section says so.
 */
export const MAX_REPORT_WRITE_QUEUE_ITEMS = 100;

/** A missing timestamp or free-text value renders as a dash, never a blank cell. */
function formatMetadataValue(value: string | null): string {
  return value !== null && value.trim().length > 0 ? value : "-";
}

/** Collapses newlines so a multiline value cannot break a Markdown heading. */
function formatHeadingText(value: string): string {
  return value.replaceAll("\n", " ").trim();
}

function formatWriteQueueItemName(item: PendingWriteQueueItem): string {
  const name = item.name?.trim() ?? "";
  return name.length > 0 ? name : item.localId;
}

function countWriteQueueOperations(
  items: ReadonlyArray<PendingWriteQueueItem>,
): number {
  return items.reduce(
    (total, item) =>
      total +
      item.operations.reduce(
        (operationTotal, operation) => operationTotal + operation.count,
        0,
      ),
    0,
  );
}

function formatWriteQueueItem(
  item: PendingWriteQueueItem,
): ReadonlyArray<string> {
  const details = formatTable(
    ["Field", "Value"],
    [
      ["Status", item.status],
      ["Object Kind", item.objectKind],
      ["Namespace", formatMetadataValue(item.namespace)],
      ["Local ID", item.localId],
      ["Remote ID", formatMetadataValue(item.remoteId)],
      ["Container ID", formatMetadataValue(item.containerId)],
      ["Organization ID", formatMetadataValue(item.organizationId)],
      ["Created", formatMetadataValue(item.createdAt)],
      ["Updated", formatMetadataValue(item.updatedAt)],
    ],
  );

  const heading = `### ${formatHeadingText(formatWriteQueueItemName(item))}`;

  if (item.operations.length === 0) {
    return [heading, "", details, "", "_No operations._"];
  }

  const operations = formatTable(
    [
      "Operation",
      "Status",
      "Count",
      "Bytes",
      "Created",
      "Updated",
      "Last Attempted",
      "Target Container",
      "Last Error",
    ],
    item.operations.map((operation) => [
      operation.kind,
      operation.status,
      String(operation.count),
      String(operation.byteLength),
      formatMetadataValue(operation.createdAt),
      formatMetadataValue(operation.updatedAt),
      formatMetadataValue(operation.lastAttemptedAt),
      formatMetadataValue(operation.targetContainerId),
      formatMetadataValue(operation.lastError),
    ]),
  );

  return [heading, "", details, "", "**Operations**", "", operations];
}

function formatWriteQueueSection(
  writeQueue: SystemMonitorWriteQueueReport,
): ReadonlyArray<string> {
  const heading = "## Write Queue";
  if (!writeQueue.available) {
    return [
      heading,
      "",
      "_The local database is not ready, so the write queue is unavailable._",
    ];
  }

  const { items } = writeQueue;
  if (items.length === 0) {
    return [heading, "", "_No pending writes._"];
  }

  const summary = `_${items.length} queued object(s), ${countWriteQueueOperations(
    items,
  )} pending write operation(s)._`;
  const visible = items.slice(0, MAX_REPORT_WRITE_QUEUE_ITEMS);
  const truncationNote =
    visible.length < items.length
      ? [
          `_Showing the first ${visible.length} of ${items.length} queued objects._`,
          "",
        ]
      : [];

  const itemSections = visible.flatMap((item) => [
    ...formatWriteQueueItem(item),
    "",
  ]);

  return [heading, "", summary, "", ...truncationNote, ...itemSections];
}

function formatSyncLaneProgress(
  progress: SyncLaneSnapshot["progress"],
): string {
  if (!progress) {
    return "-";
  }
  return `${progress.bytesUploaded} / ${progress.bytesTotal} bytes, ${progress.partsCompleted} / ${progress.partsTotal} parts`;
}

function formatSyncLane(lane: SyncLaneSnapshot): ReadonlyArray<string> {
  const details = formatTable(
    ["Field", "Value"],
    [
      ["Phase", lane.phase],
      ["Status", lane.status],
      ["Requested", lane.requested ? "yes" : "no"],
      ["Running", lane.running ? "yes" : "no"],
      ["Last Action", lane.lastAction],
      ["Last Action At", formatMetadataValue(lane.lastActionAt)],
      ["Last Requested", formatMetadataValue(lane.lastRequestedAt)],
      ["Last Started", formatMetadataValue(lane.lastStartedAt)],
      ["Last Completed", formatMetadataValue(lane.lastCompletedAt)],
      ["Last Failed", formatMetadataValue(lane.lastFailedAt)],
      ["Last Error", formatMetadataValue(lane.lastError)],
      ["Error Count", String(lane.errorCount)],
      ["Request Count", String(lane.requestCount)],
      ["Run Count", String(lane.runCount)],
      ["Registration Index", String(lane.registrationIndex)],
      ["Progress", formatSyncLaneProgress(lane.progress)],
      ["Blob Storage Key", formatMetadataValue(lane.blobStorageKey)],
    ],
  );

  return [`### ${formatHeadingText(lane.label)}`, "", details];
}

function formatSyncLanesSection(
  snapshot: DomainSyncSnapshot | null,
): ReadonlyArray<string> {
  const heading = "## Sync Lanes";
  if (!snapshot) {
    return [
      heading,
      "",
      "_The local database is not ready, so sync lanes are unavailable._",
    ];
  }

  const coordinator = formatTable(
    ["Field", "Value"],
    [
      ["Pending Work", snapshot.hasPendingWork ? "yes" : "no"],
      ["Pump Active", snapshot.pumpActive ? "yes" : "no"],
      ["Snapshot Updated", formatMetadataValue(snapshot.updatedAt)],
    ],
  );

  if (snapshot.lanes.length === 0) {
    return [heading, "", coordinator, "", "_No active sync lanes._"];
  }

  const laneSections = snapshot.lanes.flatMap((lane) => [
    ...formatSyncLane(lane),
    "",
  ]);

  return [heading, "", coordinator, "", ...laneSections];
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

  if (input.writeQueue !== undefined) {
    sections.push(...formatWriteQueueSection(input.writeQueue), "");
  }

  if (input.syncLanes !== undefined) {
    sections.push(...formatSyncLanesSection(input.syncLanes), "");
  }

  sections.push(...formatLogSection(input.logEntries), "");

  return sections.join("\n");
}
