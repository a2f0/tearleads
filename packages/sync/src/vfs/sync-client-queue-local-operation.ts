import type { QueueVfsCrdtLocalOperationInput } from './sync-client-utils.js';
import {
  isAccessLevel,
  isPrincipalType,
  normalizeOccurredAt,
  normalizeRequiredString
} from './sync-client-utils.js';
import type { VfsCrdtOperation } from './sync-crdt.js';

interface BuildQueuedLocalOperationParams {
  input: QueueVfsCrdtLocalOperationInput;
  clientId: string;
  nextLocalWriteId: number;
  pendingOpIds: Set<string>;
  now: () => Date;
}

export function buildQueuedLocalOperation({
  input,
  clientId,
  nextLocalWriteId,
  pendingOpIds,
  now
}: BuildQueuedLocalOperationParams): VfsCrdtOperation {
  const normalizedItemId = normalizeRequiredString(input.itemId);
  if (!normalizedItemId) {
    throw new Error('itemId is required');
  }

  const normalizedOccurredAt = normalizeOccurredAt(input.occurredAt);
  const occurredAt = normalizedOccurredAt ?? now().toISOString();
  const parsedOccurredAt = normalizeOccurredAt(occurredAt);
  if (!parsedOccurredAt) {
    throw new Error('occurredAt is invalid');
  }

  const candidateOpId = input.opId ?? `${clientId}-${nextLocalWriteId}`;
  const normalizedOpId = normalizeRequiredString(candidateOpId);
  if (!normalizedOpId) {
    throw new Error('opId is required');
  }
  if (pendingOpIds.has(normalizedOpId)) {
    throw new Error(`opId ${normalizedOpId} is already queued`);
  }

  const operation: VfsCrdtOperation = {
    opId: normalizedOpId,
    opType: input.opType,
    itemId: normalizedItemId,
    replicaId: clientId,
    writeId: nextLocalWriteId,
    occurredAt: parsedOccurredAt
  };

  if (input.opType === 'acl_add' || input.opType === 'acl_remove') {
    const principalType = input.principalType;
    const principalId = normalizeRequiredString(input.principalId);

    if (!isPrincipalType(principalType) || !principalId) {
      throw new Error(
        'principalType and principalId are required for acl operations'
      );
    }

    operation.principalType = principalType;
    operation.principalId = principalId;
    if (input.opType === 'acl_add') {
      const accessLevel = input.accessLevel;
      if (!isAccessLevel(accessLevel)) {
        throw new Error('accessLevel is required for acl_add');
      }

      operation.accessLevel = accessLevel;
    }
  }

  if (input.opType === 'link_add' || input.opType === 'link_remove') {
    const parentId = normalizeRequiredString(input.parentId);
    const childId = normalizeRequiredString(input.childId);
    if (!parentId || !childId) {
      throw new Error('parentId and childId are required for link operations');
    }
    if (childId !== normalizedItemId) {
      throw new Error('link childId must match itemId');
    }

    operation.parentId = parentId;
    operation.childId = childId;
  }

  return operation;
}
