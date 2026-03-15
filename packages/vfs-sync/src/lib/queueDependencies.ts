export interface SyncQueueSnapshotCrdtOp {
  opId: string;
  opType: string;
  itemId: string;
  writeId: number;
  occurredAt: string;
  encrypted: boolean;
}

export interface SyncQueueSnapshotBlobOp {
  operationId: string;
  kind: string;
  stagingId?: string | undefined;
  itemId?: string | undefined;
  chunkIndex?: number | undefined;
}

export interface SyncQueueSnapshotInboundBlobOp {
  operationId: string;
  blobId: string;
  itemId: string;
  sizeBytes: number;
}

export interface SyncQueueSnapshotOutboundBlobActivity {
  operationId: string;
  kind: string;
  success: boolean;
  timestamp: string;
  retryCount: number;
  failureClass?: string | undefined;
}

export interface SyncQueueSnapshot {
  outbound: {
    crdt: SyncQueueSnapshotCrdtOp[];
    blob: SyncQueueSnapshotBlobOp[];
    blobActivity: SyncQueueSnapshotOutboundBlobActivity[];
  };
  inbound: {
    cursor: { changedAt: string; changeId: string } | null;
    pendingOperations: number;
    nextLocalWriteId: number;
    blobDownloads: SyncQueueSnapshotInboundBlobOp[];
  };
}

export interface SyncQueueDependencies {
  useSnapshot: () => SyncQueueSnapshot;
}

let dependencies: SyncQueueDependencies | null = null;

export function setSyncQueueDependencies(next: SyncQueueDependencies): void {
  dependencies = next;
}

export function getSyncQueueDependencies(): SyncQueueDependencies | null {
  return dependencies;
}
