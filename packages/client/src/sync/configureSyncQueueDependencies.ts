import {
  type SyncQueueDependencies,
  type SyncQueueSnapshot,
  setSyncQueueDependencies
} from '@tearleads/vfs-sync/clientEntry';
import { useVfsOrchestratorInstance } from '@/contexts/VfsOrchestratorContext';

const EMPTY_SNAPSHOT: SyncQueueSnapshot = {
  outbound: { crdt: [], blob: [] },
  inbound: {
    cursor: null,
    pendingOperations: 0,
    nextLocalWriteId: 0,
    blobDownloads: []
  }
};

let configured = false;

function createDependencies(): SyncQueueDependencies {
  return {
    useSnapshot(): SyncQueueSnapshot {
      const orchestrator = useVfsOrchestratorInstance();
      if (!orchestrator) {
        return EMPTY_SNAPSHOT;
      }

      const crdtOps = orchestrator.queuedCrdtOperations();
      const blobOps = orchestrator.queuedBlobOperations();
      const crdtSnapshot = orchestrator.crdt.snapshot();

      return {
        outbound: {
          crdt: crdtOps.map((op) => ({
            opId: op.opId,
            opType: op.opType,
            itemId: op.itemId,
            writeId: op.writeId,
            occurredAt: op.occurredAt,
            encrypted: op.encryptedPayload !== undefined
          })),
          blob: blobOps.map((op) => ({
            operationId: op.operationId,
            kind: op.kind,
            stagingId:
              'payload' in op && 'stagingId' in op.payload
                ? (op.payload.stagingId as string)
                : undefined,
            itemId:
              'payload' in op && 'itemId' in op.payload
                ? (op.payload.itemId as string)
                : undefined,
            chunkIndex:
              'payload' in op && 'chunkIndex' in op.payload
                ? (op.payload.chunkIndex as number)
                : undefined
          }))
        },
        inbound: {
          cursor: crdtSnapshot.cursor,
          pendingOperations: crdtSnapshot.pendingOperations,
          nextLocalWriteId: crdtSnapshot.nextLocalWriteId,
          blobDownloads: []
        }
      };
    }
  };
}

export function configureSyncQueueDependencies(): void {
  if (configured) {
    return;
  }

  setSyncQueueDependencies(createDependencies());
  configured = true;
}
