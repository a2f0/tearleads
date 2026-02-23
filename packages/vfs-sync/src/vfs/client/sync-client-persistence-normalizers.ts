import {
  isAccessLevel,
  isCrdtOpType,
  isPrincipalType,
  normalizeCursor,
  normalizeOccurredAt,
  normalizeRequiredString,
  parsePositiveSafeInteger
} from './sync-client-utils.js';
import type { VfsContainerClockEntry } from '../protocol/sync-container-clocks.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import type { VfsCrdtFeedReplaySnapshot } from '../protocol/sync-crdt-feed-replay.js';
import {
  parseVfsCrdtLastReconciledWriteIds,
  type VfsCrdtClientReconcileState
} from '../protocol/sync-crdt-reconcile.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';

export function normalizePersistedReplaySnapshot(
  value: VfsCrdtFeedReplaySnapshot
): VfsCrdtFeedReplaySnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new Error('state.replaySnapshot must be an object');
  }
  if (!Array.isArray(value.acl)) {
    throw new Error('state.replaySnapshot.acl must be an array');
  }
  if (!Array.isArray(value.links)) {
    throw new Error('state.replaySnapshot.links must be an array');
  }

  const normalizedAcl = value.acl.map((entry, index) => {
    const itemId = normalizeRequiredString(entry.itemId);
    const principalType = isPrincipalType(entry.principalType)
      ? entry.principalType
      : null;
    const principalId = normalizeRequiredString(entry.principalId);
    const accessLevel = isAccessLevel(entry.accessLevel)
      ? entry.accessLevel
      : null;
    if (!itemId || !principalType || !principalId || !accessLevel) {
      throw new Error(`state.replaySnapshot.acl[${index}] is invalid`);
    }

    return {
      itemId,
      principalType,
      principalId,
      accessLevel
    };
  });

  const normalizedLinks = value.links.map((entry, index) => {
    const parentId = normalizeRequiredString(entry.parentId);
    const childId = normalizeRequiredString(entry.childId);
    if (!parentId || !childId) {
      throw new Error(`state.replaySnapshot.links[${index}] is invalid`);
    }

    return {
      parentId,
      childId
    };
  });

  let normalizedCursor: VfsSyncCursor | null = null;
  if (value.cursor !== null) {
    normalizedCursor = normalizeCursor(value.cursor, 'persisted replay cursor');
  }

  return {
    acl: normalizedAcl,
    links: normalizedLinks,
    cursor: normalizedCursor
  };
}

export function normalizePersistedReconcileState(
  value: VfsCrdtClientReconcileState | null
): VfsCrdtClientReconcileState | null {
  if (value === null) {
    return null;
  }

  const normalizedCursor = normalizeCursor(
    value.cursor,
    'persisted reconcile cursor'
  );
  const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(
    value.lastReconciledWriteIds
  );
  if (!parsedWriteIds.ok) {
    throw new Error(parsedWriteIds.error);
  }

  return {
    cursor: normalizedCursor,
    lastReconciledWriteIds: parsedWriteIds.value
  };
}

export function normalizePersistedContainerClocks(
  clocks: VfsContainerClockEntry[]
): VfsContainerClockEntry[] {
  const observedContainerIds: Set<string> = new Set();
  return clocks.map((clock, index) => {
    const containerId = normalizeRequiredString(clock.containerId);
    const changeId = normalizeRequiredString(clock.changeId);
    const changedAt = normalizeOccurredAt(clock.changedAt);
    if (!containerId || !changeId || !changedAt) {
      throw new Error(`state.containerClocks[${index}] is invalid`);
    }
    if (observedContainerIds.has(containerId)) {
      throw new Error(
        `state.containerClocks has duplicate containerId ${containerId}`
      );
    }
    observedContainerIds.add(containerId);

    return {
      containerId,
      changeId,
      changedAt
    };
  });
}

export function normalizePersistedPendingOperation(input: {
  operation: VfsCrdtOperation;
  index: number;
  clientId: string;
}): VfsCrdtOperation {
  const { operation, index, clientId } = input;
  const opType = isCrdtOpType(operation.opType) ? operation.opType : null;
  if (!opType) {
    throw new Error(`state.pendingOperations[${index}].opType is invalid`);
  }

  const opId = normalizeRequiredString(operation.opId);
  const itemId = normalizeRequiredString(operation.itemId);
  const replicaId = normalizeRequiredString(operation.replicaId);
  const occurredAt = normalizeOccurredAt(operation.occurredAt);
  if (!opId || !itemId || !replicaId || !occurredAt) {
    throw new Error(`state.pendingOperations[${index}] is invalid`);
  }
  if (replicaId !== clientId) {
    throw new Error(
      `state.pendingOperations[${index}] has replicaId that does not match clientId`
    );
  }

  const writeId = parsePositiveSafeInteger(
    operation.writeId,
    `state.pendingOperations[${index}].writeId`
  );

  const normalized: VfsCrdtOperation = {
    opId,
    opType,
    itemId,
    replicaId,
    writeId,
    occurredAt
  };

  if (opType === 'acl_add' || opType === 'acl_remove') {
    const principalType = isPrincipalType(operation.principalType)
      ? operation.principalType
      : null;
    const principalId = normalizeRequiredString(operation.principalId);
    if (!principalType || !principalId) {
      throw new Error(
        `state.pendingOperations[${index}] is missing acl principal fields`
      );
    }
    normalized.principalType = principalType;
    normalized.principalId = principalId;

    if (opType === 'acl_add') {
      const accessLevel = isAccessLevel(operation.accessLevel)
        ? operation.accessLevel
        : null;
      if (!accessLevel) {
        throw new Error(
          `state.pendingOperations[${index}] is missing acl accessLevel`
        );
      }
      normalized.accessLevel = accessLevel;
    }
  }

  if (opType === 'link_add' || opType === 'link_remove') {
    const parentId = normalizeRequiredString(operation.parentId);
    const childId = normalizeRequiredString(operation.childId);
    if (!parentId || !childId) {
      throw new Error(
        `state.pendingOperations[${index}] is missing link fields`
      );
    }
    if (childId !== itemId) {
      throw new Error(
        `state.pendingOperations[${index}] has link childId that does not match itemId`
      );
    }
    normalized.parentId = parentId;
    normalized.childId = childId;
  }

  if (operation.encryptedPayload !== undefined) {
    const encryptedPayload = normalizeRequiredString(
      operation.encryptedPayload
    );
    if (!encryptedPayload) {
      throw new Error(
        `state.pendingOperations[${index}] has invalid encryptedPayload`
      );
    }
    normalized.encryptedPayload = encryptedPayload;

    const keyEpoch = parsePositiveSafeInteger(
      operation.keyEpoch,
      `state.pendingOperations[${index}].keyEpoch`
    );
    normalized.keyEpoch = keyEpoch;

    if (operation.encryptionNonce !== undefined) {
      const encryptionNonce = normalizeRequiredString(
        operation.encryptionNonce
      );
      if (encryptionNonce) {
        normalized.encryptionNonce = encryptionNonce;
      }
    }
    if (operation.encryptionAad !== undefined) {
      const encryptionAad = normalizeRequiredString(operation.encryptionAad);
      if (encryptionAad) {
        normalized.encryptionAad = encryptionAad;
      }
    }
    if (operation.encryptionSignature !== undefined) {
      const encryptionSignature = normalizeRequiredString(
        operation.encryptionSignature
      );
      if (encryptionSignature) {
        normalized.encryptionSignature = encryptionSignature;
      }
    }
  }

  return normalized;
}
