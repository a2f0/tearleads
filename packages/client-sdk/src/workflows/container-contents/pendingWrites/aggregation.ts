import type {
  PendingWriteQueueItem,
  PendingWriteQueueItemStatus,
  PendingWriteQueueObjectKind,
  PendingWriteQueueOperation,
  PendingWriteQueueOperationKind,
  PendingWriteQueueOperationStatus,
} from "../pendingWritesTypes";

export type PendingWriteCandidateInclusion =
  | "always"
  | "unless-item-covered"
  | "unless-operation-covered";

export interface PendingWriteCandidate {
  readonly byteLength: number;
  readonly containerId: string | null;
  readonly count: number;
  readonly createdAt: string | null;
  readonly inclusion: PendingWriteCandidateInclusion;
  readonly kind: PendingWriteQueueOperationKind;
  readonly lastAttemptedAt: string | null;
  readonly lastError: string | null;
  readonly localId: string;
  readonly name: string | null;
  readonly namespace: string | null;
  readonly objectKind: PendingWriteQueueObjectKind;
  readonly organizationId: string | null;
  readonly remoteId: string | null;
  readonly status: PendingWriteQueueOperationStatus;
  readonly targetContainerId: string | null;
  readonly updatedAt: string | null;
}

interface PendingWriteItemBuilder {
  containerId: string | null;
  localId: string;
  name: string | null;
  namespace: string | null;
  objectKind: PendingWriteQueueObjectKind;
  operations: PendingWriteQueueOperation[];
  organizationId: string | null;
  remoteId: string | null;
}

const INCLUSION_RANK: Record<PendingWriteCandidateInclusion, number> = {
  always: 0,
  "unless-operation-covered": 1,
  "unless-item-covered": 2,
};

const OPERATION_RANK: Record<PendingWriteQueueOperationKind, number> = {
  create: 0,
  move: 1,
  update: 2,
  "deferred-update": 3,
  attachment: 4,
  // Diagnostic-only: a refused read-only revalidation, never local data.
  revalidation: 5,
};

const OBJECT_RANK: Record<PendingWriteQueueObjectKind, number> = {
  container: 0,
  document: 1,
  unknown: 2,
};

function candidateKey(candidate: PendingWriteCandidate): string {
  return [
    candidate.objectKind,
    candidate.namespace ?? "",
    candidate.localId,
  ].join("\0");
}

function createItemBuilder(
  candidate: PendingWriteCandidate,
): PendingWriteItemBuilder {
  return {
    containerId: candidate.containerId,
    localId: candidate.localId,
    name: candidate.name,
    namespace: candidate.namespace,
    objectKind: candidate.objectKind,
    operations: [],
    organizationId: candidate.organizationId,
    remoteId: candidate.remoteId,
  };
}

function mergeItemMetadata(
  item: PendingWriteItemBuilder,
  candidate: PendingWriteCandidate,
): void {
  item.containerId ??= candidate.containerId;
  item.name ??= candidate.name;
  item.organizationId ??= candidate.organizationId;
  item.remoteId ??= candidate.remoteId;
}

function shouldIncludeCandidate(
  item: PendingWriteItemBuilder | undefined,
  candidate: PendingWriteCandidate,
): boolean {
  if (candidate.inclusion === "always") {
    return true;
  }
  if (candidate.inclusion === "unless-item-covered") {
    return !item || item.operations.length === 0;
  }
  return !item?.operations.some(
    (operation) => operation.kind === candidate.kind,
  );
}

function operationFromCandidate(
  candidate: PendingWriteCandidate,
): PendingWriteQueueOperation {
  return {
    byteLength: candidate.byteLength,
    count: candidate.count,
    createdAt: candidate.createdAt,
    kind: candidate.kind,
    lastAttemptedAt: candidate.lastAttemptedAt,
    lastError: candidate.lastError,
    status: candidate.status,
    targetContainerId: candidate.targetContainerId,
    updatedAt: candidate.updatedAt,
  };
}

function earliestTimestamp(
  operations: ReadonlyArray<PendingWriteQueueOperation>,
): string | null {
  const timestamps = operations.flatMap((operation) =>
    operation.createdAt ? [operation.createdAt] : [],
  );
  return timestamps.length > 0 ? (timestamps.sort()[0] ?? null) : null;
}

function latestTimestamp(
  operations: ReadonlyArray<PendingWriteQueueOperation>,
): string | null {
  const timestamps = operations.flatMap((operation) => {
    const timestamp = operation.updatedAt ?? operation.createdAt;
    return timestamp ? [timestamp] : [];
  });
  return timestamps.length > 0 ? (timestamps.sort().at(-1) ?? null) : null;
}

function resolveItemStatus(
  operations: ReadonlyArray<PendingWriteQueueOperation>,
): PendingWriteQueueItemStatus {
  if (operations.some((operation) => operation.status === "blocked")) {
    return "blocked";
  }
  if (operations.some((operation) => operation.lastError !== null)) {
    return "error";
  }
  return "pending";
}

function compareOperations(
  left: PendingWriteQueueOperation,
  right: PendingWriteQueueOperation,
): number {
  return (
    OPERATION_RANK[left.kind] - OPERATION_RANK[right.kind] ||
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "")
  );
}

function compareItems(
  left: PendingWriteQueueItem,
  right: PendingWriteQueueItem,
): number {
  const leftTimestamp = left.createdAt ?? left.updatedAt;
  const rightTimestamp = right.createdAt ?? right.updatedAt;
  if (leftTimestamp !== rightTimestamp) {
    if (leftTimestamp === null) return 1;
    if (rightTimestamp === null) return -1;
    return leftTimestamp.localeCompare(rightTimestamp);
  }
  return (
    OBJECT_RANK[left.objectKind] - OBJECT_RANK[right.objectKind] ||
    (left.namespace ?? "").localeCompare(right.namespace ?? "") ||
    left.localId.localeCompare(right.localId)
  );
}

export function groupPendingWriteCandidates(
  candidates: ReadonlyArray<PendingWriteCandidate>,
): PendingWriteQueueItem[] {
  const itemsByKey = new Map<string, PendingWriteItemBuilder>();
  const orderedCandidates = [...candidates].sort(
    (left, right) =>
      INCLUSION_RANK[left.inclusion] - INCLUSION_RANK[right.inclusion],
  );

  for (const candidate of orderedCandidates) {
    const key = candidateKey(candidate);
    const existing = itemsByKey.get(key);
    if (existing) {
      mergeItemMetadata(existing, candidate);
    }
    if (!shouldIncludeCandidate(existing, candidate)) {
      continue;
    }
    const item = existing ?? createItemBuilder(candidate);
    item.operations.push(operationFromCandidate(candidate));
    itemsByKey.set(key, item);
  }

  return Array.from(itemsByKey.values(), (item): PendingWriteQueueItem => {
    const operations = [...item.operations].sort(compareOperations);
    return {
      containerId: item.containerId,
      createdAt: earliestTimestamp(operations),
      localId: item.localId,
      name: item.name,
      namespace: item.namespace,
      objectKind: item.objectKind,
      operations,
      organizationId: item.organizationId,
      remoteId: item.remoteId,
      status: resolveItemStatus(operations),
      updatedAt: latestTimestamp(operations),
    };
  }).sort(compareItems);
}
