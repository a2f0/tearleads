export type PendingWriteQueueObjectKind = "container" | "document" | "unknown";

export type PendingWriteQueueOperationKind =
  | "attachment"
  | "create"
  | "deferred-update"
  | "move"
  | "revalidation"
  | "update";

export type PendingWriteQueueOperationStatus = "pending" | "blocked";
export type PendingWriteQueueItemStatus =
  | PendingWriteQueueOperationStatus
  | "error";

/** Safe, payload-free description of one kind of durable outbound work. */
export interface PendingWriteQueueOperation {
  readonly byteLength: number;
  readonly count: number;
  readonly createdAt: string | null;
  readonly kind: PendingWriteQueueOperationKind;
  readonly lastAttemptedAt: string | null;
  readonly lastError: string | null;
  readonly status: PendingWriteQueueOperationStatus;
  readonly targetContainerId: string | null;
  readonly updatedAt: string | null;
}

/**
 * Identity-wide pending work grouped by its logical container, document, or
 * otherwise unknown document namespace. Serialized Loro updates, storage keys,
 * encryption material, and attachment upload identities are intentionally not
 * exposed.
 */
export interface PendingWriteQueueItem {
  readonly containerId: string | null;
  readonly createdAt: string | null;
  readonly localId: string;
  readonly name: string | null;
  /** Present only for an unrecognized `documents.app_kind` namespace. */
  readonly namespace: string | null;
  readonly objectKind: PendingWriteQueueObjectKind;
  readonly operations: ReadonlyArray<PendingWriteQueueOperation>;
  readonly organizationId: string | null;
  readonly remoteId: string | null;
  readonly status: PendingWriteQueueItemStatus;
  readonly updatedAt: string | null;
}
