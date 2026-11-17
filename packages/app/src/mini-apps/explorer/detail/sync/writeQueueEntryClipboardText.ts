import type {
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
} from "@tearleads/client-sdk";
import { EXPLORER_LABELS } from "../../labels";

function formatValue(value: string | null): string {
  return value !== null && value.trim().length > 0 ? value : "-";
}

function formatOperation(
  operation: PendingWriteQueueOperation,
): ReadonlyArray<string> {
  const size =
    operation.kind === "attachment" ? ` (${operation.byteLength} bytes)` : "";
  const lines = [
    `- ${operation.kind} x${operation.count}${size}: ${operation.status}`,
  ];
  if (operation.targetContainerId !== null) {
    lines.push(`  Target Container ID: ${operation.targetContainerId}`);
  }
  if (operation.lastError !== null) {
    lines.push(`  Last Error: ${operation.lastError}`);
  }
  if (operation.lastAttemptedAt !== null) {
    lines.push(`  Last Attempted: ${operation.lastAttemptedAt}`);
  }
  return lines;
}

// One write-queue entry as plain text for pasting into a bug report. It
// carries ids, statuses, timestamps, and error text only. Organization,
// container, and document names are left out (their ids stand in for them),
// so a paste does not disclose which organization or document is involved.
// Values are the SDK's own (`pending`, `deferred-update`), not display labels,
// so they can be matched against the code.
export function getWriteQueueEntryClipboardText(params: {
  billingBlocked: boolean;
  item: PendingWriteQueueItem;
}): string {
  const { item } = params;
  const status =
    params.billingBlocked && item.status === "pending"
      ? `${item.status} (${EXPLORER_LABELS.writeQueueBillingPaused})`
      : item.status;
  return [
    EXPLORER_LABELS.writeQueueEntryDetailTitle,
    `Object Kind: ${item.objectKind}`,
    ...(item.namespace === null ? [] : [`Namespace: ${item.namespace}`]),
    `Local ID: ${item.localId}`,
    `Remote ID: ${formatValue(item.remoteId)}`,
    `Container ID: ${formatValue(item.containerId)}`,
    `Organization ID: ${formatValue(item.organizationId)}`,
    `Status: ${status}`,
    `Created: ${formatValue(item.createdAt)}`,
    `Updated: ${formatValue(item.updatedAt)}`,
    "Operations:",
    ...item.operations.flatMap(formatOperation),
  ].join("\n");
}
