import type {
  CompletedDownloadItem,
  PendingDownloadQueueItem,
} from "@tearleads/client-sdk";

/**
 * One Downloads row: a pull still in the SDK's durable queue, or one the SDK
 * recorded finishing in this domain scope, which says where its stored
 * content can be opened.
 */
export type DownloadHistoryEntry =
  | { readonly item: PendingDownloadQueueItem; readonly status: "pending" }
  | { readonly item: CompletedDownloadItem; readonly status: "complete" };

export function getDownloadHistoryKey(
  item: PendingDownloadQueueItem | CompletedDownloadItem,
): string {
  return item.objectKind === "attachment"
    ? `attachment:${item.localId}:${item.slotId}`
    : `${item.objectKind}:${item.localId}`;
}

/**
 * Pending rows in queue order, then finished downloads, newest first. A
 * finished download that is back in the queue is listed once, as pending.
 */
export function mergeDownloadHistory(
  pending: ReadonlyArray<PendingDownloadQueueItem>,
  completed: ReadonlyArray<CompletedDownloadItem>,
): ReadonlyArray<DownloadHistoryEntry> {
  const pendingKeys = new Set(pending.map(getDownloadHistoryKey));
  return [
    ...pending.map(
      (item): DownloadHistoryEntry => ({ item, status: "pending" }),
    ),
    ...completed.flatMap((item): DownloadHistoryEntry[] =>
      pendingKeys.has(getDownloadHistoryKey(item))
        ? []
        : [{ item, status: "complete" }],
    ),
  ];
}
