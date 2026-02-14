import {
  type AbandonVfsBlobInput,
  type AttachVfsBlobInput,
  InMemoryVfsBlobCommitStore,
  type StageVfsBlobInput,
  type VfsBlobCommitStatus,
  type VfsBlobStageRecord
} from './sync-blob-commit.js';
import {
  InMemoryVfsCrdtClientStateStore,
  type ReconcileVfsCrdtClientStateResult,
  type VfsCrdtLastReconciledWriteIds
} from './sync-crdt-reconcile.js';
import type { VfsSyncCursor } from './sync-cursor.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

export type VfsBlobIsolationAttachStatus =
  | VfsBlobCommitStatus
  | 'reconcileRequired'
  | 'reconcileBehind';

export interface AttachVfsBlobWithIsolationInput extends AttachVfsBlobInput {
  userId: string;
  clientId: string;
  requiredCursor: VfsSyncCursor;
  requiredLastWriteIds: VfsCrdtLastReconciledWriteIds;
}

export interface VfsBlobIsolationAttachResult {
  stagingId: string;
  status: VfsBlobIsolationAttachStatus;
  record: VfsBlobStageRecord | null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dominatesLastWriteIds(
  current: VfsCrdtLastReconciledWriteIds,
  required: VfsCrdtLastReconciledWriteIds
): boolean {
  for (const [replicaId, requiredWriteId] of Object.entries(required)) {
    const currentWriteId = current[replicaId] ?? 0;
    if (currentWriteId < requiredWriteId) {
      return false;
    }
  }

  return true;
}

/**
 * Guardrail store that requires reconcile state to dominate client-provided
 * visibility checkpoints before blob attach is accepted.
 * This is intentionally object-type agnostic: email attachments use the same
 * itemId-based isolation contract as every other VFS object.
 */
export class InMemoryVfsBlobIsolationStore {
  private readonly blobStore = new InMemoryVfsBlobCommitStore();
  private readonly crdtClientStateStore = new InMemoryVfsCrdtClientStateStore();

  stage(input: StageVfsBlobInput) {
    return this.blobStore.stage(input);
  }

  abandon(input: AbandonVfsBlobInput) {
    return this.blobStore.abandon(input);
  }

  reconcileClient(
    userId: string,
    clientId: string,
    cursor: VfsSyncCursor,
    lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds
  ): ReconcileVfsCrdtClientStateResult {
    return this.crdtClientStateStore.reconcile(
      userId,
      clientId,
      cursor,
      lastReconciledWriteIds
    );
  }

  attachWithIsolation(
    input: AttachVfsBlobWithIsolationInput
  ): VfsBlobIsolationAttachResult {
    const stagingId = normalizeNonEmptyString(input.stagingId);
    if (!stagingId) {
      return {
        stagingId: 'invalid-attach',
        status: 'invalid',
        record: null
      };
    }

    const userId = normalizeNonEmptyString(input.userId);
    const clientId = normalizeNonEmptyString(input.clientId);
    if (!userId || !clientId) {
      return {
        stagingId,
        status: 'invalid',
        record: this.blobStore.get(stagingId)
      };
    }

    const reconcileState = this.crdtClientStateStore.get(userId, clientId);
    if (!reconcileState) {
      return {
        stagingId,
        status: 'reconcileRequired',
        record: this.blobStore.get(stagingId)
      };
    }

    if (
      compareVfsSyncCursorOrder(reconcileState.cursor, input.requiredCursor) < 0
    ) {
      return {
        stagingId,
        status: 'reconcileBehind',
        record: this.blobStore.get(stagingId)
      };
    }

    if (
      !dominatesLastWriteIds(
        reconcileState.lastReconciledWriteIds,
        input.requiredLastWriteIds
      )
    ) {
      return {
        stagingId,
        status: 'reconcileBehind',
        record: this.blobStore.get(stagingId)
      };
    }

    return this.blobStore.attach(input);
  }

  getBlobStage(stagingId: string): VfsBlobStageRecord | null {
    return this.blobStore.get(stagingId);
  }
}
