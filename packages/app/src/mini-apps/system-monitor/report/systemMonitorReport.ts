import type {
  DomainSyncSnapshot,
  PendingWriteQueueItem,
  SyncLaneSnapshot,
} from "@symcrypt/client-sdk";
import { DOCUMENT_SYNC_TRACE_FRAGMENT } from "@symcrypt/client-sdk";
import {
  formatPaneLogLine,
  type PaneLogEntry,
} from "../../../components/pane/log/PaneLog";
import {
  NO_STATUS_VALUE,
  STATUS_LABELS,
  type SystemStatusSnapshot,
} from "../../../components/pane/status/useSystemStatusSnapshot";
import { IDENTITY_TRANSITION_TRACE_FRAGMENT } from "../../../providers/identity/identityTransitionTrace";
import { BILLING_PURCHASE_TRACE_FRAGMENT } from "../../../utils/billingPurchaseTrace";
import type { EnvironmentRow } from "../environment/useSystemEnvironment";

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
 * items are the SDK's payload-free projection (`PendingWriteQueueItem`). The
 * report omits decrypted display names and redacts every free-text diagnostic;
 * serialized Loro updates, storage keys, encryption material, titles, names,
 * errors, and content are never copied into the clipboard report.
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
 * Only count/status telemetry with an anchored shape is copied. Arbitrary log
 * messages can contain decrypted names or content, so they fail closed and are
 * omitted. The safe subset is capped so a report stays pasteable.
 */
export const MAX_REPORT_LOG_ENTRIES = 200;

// Composed, not copied: the sync-trace alternatives come from the SDK module
// that emits them, so a new trace shape cannot drift out of the allowlist.
// Every trace line is built from anchored tokens (UUIDs, counts, enums) and
// never carries decrypted content, names, key material, or free-form errors.
//
// Built lazily on first use, NOT at module scope: this module sits in an
// import cycle with the SDK root barrel, and reading the fragment during
// module evaluation crashes app boot (the barrel's namespace is not yet
// initialized). By the time a report is copied, every module is evaluated
// and the live binding is safe to read.
let clipboardSafeLogPattern: RegExp | null = null;

function getClipboardSafeLogPattern(): RegExp {
  clipboardSafeLogPattern ??= new RegExp(
    `(?:^|: )((?:document priming candidates=\\d+ roots=\\d+ primed=\\d+ unroutable=\\d+)|(?:stale root recovery status=(?:already-adopted|ambiguous|context-changed|reassigned|unsupported) candidates=\\d+(?: occurrences=\\d+)?)|(?:interest baseline containers=\\d+)|(?:interest declaration acknowledged)|(?:remote revalidation scheduled reason=(?:reconnect|startup))|(?:remote revalidation result=(?:applied incomingUpdates=\\d+ attachmentSlots=\\d+|unavailable))|(?:${DOCUMENT_SYNC_TRACE_FRAGMENT})|(?:${IDENTITY_TRANSITION_TRACE_FRAGMENT})|(?:${BILLING_PURCHASE_TRACE_FRAGMENT}))$`,
    "u",
  );
  return clipboardSafeLogPattern;
}

function getClipboardSafeLogMessage(message: string): string | null {
  return getClipboardSafeLogPattern().exec(message)?.[1] ?? null;
}

/**
 * Escapes a value for a Markdown table cell. A stray `|` would otherwise split
 * a cell into two and silently corrupt the row.
 */
function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/gu, " ");
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
        : `${status.events.length} event${status.events.length === 1 ? "" : "s"}`,
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
  const safeEntries = logEntries.flatMap((entry) => {
    const message = getClipboardSafeLogMessage(entry.message);
    return message ? [{ ...entry, message }] : [];
  });
  const omittedCount = logEntries.length - safeEntries.length;
  const omissionNote =
    omittedCount > 0
      ? [
          `_Omitted ${omittedCount} free-form log entr${omittedCount === 1 ? "y" : "ies"} to protect decrypted customer data._`,
          "",
        ]
      : [];
  if (safeEntries.length === 0) {
    return [
      "## Logs",
      "",
      ...omissionNote,
      "_No content-free telemetry entries._",
    ];
  }

  const visible = safeEntries.slice(-MAX_REPORT_LOG_ENTRIES);
  const truncationNote =
    visible.length < safeEntries.length
      ? [
          `_Showing the last ${visible.length} of ${safeEntries.length} content-free telemetry entries._`,
          "",
        ]
      : [];

  const lines = visible.map(formatPaneLogLine);
  const fence = fenceForContent(lines.join("\n"));

  return [
    "## Logs",
    "",
    ...omissionNote,
    ...truncationNote,
    `${fence}text`,
    ...lines,
    fence,
  ];
}

/**
 * Write-queue objects are capped like the log so a busy import (which can queue
 * hundreds of objects) keeps the report pasteable. A truncated section says so.
 */
export const MAX_REPORT_WRITE_QUEUE_ITEMS = 100;

function hasText(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

/** A missing timestamp or free-text value renders as a dash, never a blank cell. */
function formatMetadataValue(value: string | null): string {
  return hasText(value) ? value : "-";
}

function formatRedactedPresence(value: string | null): string {
  return hasText(value) ? "[redacted]" : "-";
}

const OPAQUE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function formatOpaqueIdentifier(value: string | null): string {
  if (!hasText(value)) {
    return "-";
  }
  return OPAQUE_UUID_PATTERN.test(value.trim()) ? value.trim() : "[redacted]";
}

/** Collapses newlines so a multiline value cannot break a Markdown heading. */
function formatHeadingText(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

function formatWriteQueueItemHeading(item: PendingWriteQueueItem): string {
  return `${item.objectKind} ${formatOpaqueIdentifier(item.localId)}`;
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
      ["Namespace", formatRedactedPresence(item.namespace)],
      ["Local ID", formatOpaqueIdentifier(item.localId)],
      ["Remote ID", formatOpaqueIdentifier(item.remoteId)],
      ["Container ID", formatOpaqueIdentifier(item.containerId)],
      ["Organization ID", formatOpaqueIdentifier(item.organizationId)],
      ["Created", formatMetadataValue(item.createdAt)],
      ["Updated", formatMetadataValue(item.updatedAt)],
    ],
  );

  const heading = `### ${formatHeadingText(formatWriteQueueItemHeading(item))}`;

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
      formatOpaqueIdentifier(operation.targetContainerId),
      formatRedactedPresence(operation.lastError),
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
      ["Last Error", formatRedactedPresence(lane.lastError)],
      ["Error Count", String(lane.errorCount)],
      ["Request Count", String(lane.requestCount)],
      ["Run Count", String(lane.runCount)],
      ["Registration Index", String(lane.registrationIndex)],
      ["Progress", formatSyncLaneProgress(lane.progress)],
      ["Blob Storage Key", formatRedactedPresence(lane.blobStorageKey)],
    ],
  );

  return [`### ${lane.phase} lane ${lane.registrationIndex}`, "", details];
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
