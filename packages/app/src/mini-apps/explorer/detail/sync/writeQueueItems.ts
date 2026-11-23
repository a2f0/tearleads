import type {
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
} from "@tearleads/client-sdk";
import {
  EXPLORER_LABELS,
  getExplorerWriteQueueAttachmentLabel,
  getExplorerWriteQueueMetadataUpdateLabel,
  getExplorerWriteQueueUpdateLabel,
} from "../../labels";

export function getOperationLabel(
  operation: PendingWriteQueueOperation,
  item: PendingWriteQueueItem,
  containerNamesById: ReadonlyMap<string, string>,
): string {
  if (operation.kind === "attachment") {
    return getExplorerWriteQueueAttachmentLabel(
      operation.count,
      operation.byteLength,
    );
  }
  if (operation.kind === "create") {
    return EXPLORER_LABELS.writeQueueCreateOperation;
  }
  if (operation.kind === "deferred-update") {
    return EXPLORER_LABELS.writeQueueDeferredUpdateOperation;
  }
  if (operation.kind === "revalidation") {
    return EXPLORER_LABELS.writeQueueRevalidationOperation;
  }
  if (operation.kind === "move") {
    const target = operation.targetContainerId
      ? (containerNamesById.get(operation.targetContainerId) ??
        operation.targetContainerId)
      : null;
    return target
      ? `${EXPLORER_LABELS.writeQueueMoveOperation} ${EXPLORER_LABELS.writeQueueTargetPrefix} ${target}`
      : EXPLORER_LABELS.writeQueueMoveOperation;
  }

  return item.objectKind === "container"
    ? getExplorerWriteQueueMetadataUpdateLabel(operation.count)
    : getExplorerWriteQueueUpdateLabel(operation.count);
}

export function getOperationsLabel(
  item: PendingWriteQueueItem,
  containerNamesById: ReadonlyMap<string, string>,
): string {
  return item.operations
    .map((operation) => getOperationLabel(operation, item, containerNamesById))
    .join(" · ");
}

export function getObjectTypeLabel(
  objectKind: PendingWriteQueueItem["objectKind"],
): string {
  if (objectKind === "container") {
    return EXPLORER_LABELS.writeQueueContainerType;
  }
  if (objectKind === "document") {
    return EXPLORER_LABELS.writeQueueDocumentType;
  }
  return EXPLORER_LABELS.writeQueueUnknownObjectType;
}

/** The entry's type and id, as the line under its name reads them. */
export function getWriteQueueItemIdentity(item: PendingWriteQueueItem): string {
  const typeLabel =
    item.objectKind === "unknown" && item.namespace
      ? item.namespace
      : getObjectTypeLabel(item.objectKind);
  return `${typeLabel} · ${item.localId}`;
}

export function getStatusLabel(
  status: PendingWriteQueueItem["status"],
): string {
  if (status === "error") {
    return EXPLORER_LABELS.writeQueueErrorStatus;
  }
  if (status === "blocked") {
    return EXPLORER_LABELS.writeQueueBlockedStatus;
  }
  return EXPLORER_LABELS.writeQueuePendingStatus;
}

export function getWriteQueueItemName(item: PendingWriteQueueItem): string {
  const displayName = item.name?.trim() ?? "";
  return displayName.length > 0 ? displayName : item.localId;
}

/** The first error any of the entry's operations recorded, if one did. */
export function getWriteQueueItemError(
  item: PendingWriteQueueItem,
): string | null {
  return (
    item.operations.find((operation) => operation.lastError)?.lastError ?? null
  );
}

/** Every queued write the entries hold, across their operations. */
export function countWriteQueueWrites(
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

// The entry's full identity: pending writes are grouped by
// (objectKind, namespace, localId), so a localId alone can be ambiguous (e.g.
// two unrecognized namespaces). This same key backs the row key, the detail
// route, and the detail lookup so they can never disagree about which entry is
// meant.
export function getWriteQueueItemKey(item: PendingWriteQueueItem): string {
  return `${item.objectKind}:${item.namespace ?? ""}:${item.localId}`;
}

// Discard tears down local state and re-pulls the server copy, so it only
// applies to documents that exist remotely (a local-only document's queued
// create is its ONLY copy), are linked to a container (the shell needs an
// anchor to re-pull into), and have no queued move — a pending move makes the
// local placement optimistic, not server truth. The SDK refuses all three cases
// too; hiding the action keeps a confirmed dialog from silently doing nothing.
export function canDiscardWriteQueueItem(item: PendingWriteQueueItem): boolean {
  return (
    item.objectKind === "document" &&
    item.remoteId !== null &&
    item.containerId !== null &&
    item.operations.every((operation) => operation.kind !== "move") &&
    // A failure-only revalidation item carries NO local data; offering the
    // destructive discard there would delete durable history for nothing.
    item.operations.some((operation) => operation.kind !== "revalidation")
  );
}
