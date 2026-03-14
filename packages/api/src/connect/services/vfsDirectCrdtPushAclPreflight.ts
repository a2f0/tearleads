import type {
  VfsCrdtPushOperation,
  VfsCrdtPushStatus
} from '@tearleads/shared';
import {
  type AclTargetState,
  isAclMutationAuthorized,
  isAclOperation,
  loadAclTargetState,
  normalizeAclOperation
} from './vfsDirectCrdtPushAclGuardrails.js';
import {
  buildAclAuditEntry,
  validateAclOperationSemantics
} from './vfsDirectCrdtPushAclValidation.js';
import type { TimedQueryRunner } from './vfsDirectCrdtPushApplyHelpers.js';

export interface ApplyAclAuthorizationInfo {
  accessRank: number;
  isOwner: boolean;
  ownerId: string | null;
}

interface ItemOwnerLike {
  owner_id: string | null;
}

export type PrepareAclOperationResult =
  | {
      kind: 'allowed';
      operationToPersist: VfsCrdtPushOperation;
    }
  | {
      auditReason: string;
      kind: 'denied';
      resultStatus: VfsCrdtPushStatus;
      warningEntry?: ReturnType<typeof buildAclAuditEntry>;
    };

export async function prepareAclOperation(input: {
  aclTargetStateCache: Map<string, AclTargetState>;
  actorAccessRanksByItemId: Map<string, number>;
  actorId: string;
  authInfo: ApplyAclAuthorizationInfo;
  itemOwnersById: Map<string, ItemOwnerLike>;
  operation: VfsCrdtPushOperation;
  runQuery: TimedQueryRunner;
}): Promise<PrepareAclOperationResult> {
  if (!isAclOperation(input.operation)) {
    return {
      kind: 'allowed',
      operationToPersist: input.operation
    };
  }

  const validation = validateAclOperationSemantics(input.operation, {
    actorId: input.actorId,
    actorAccessRank: input.authInfo.accessRank,
    isItemOwner: input.authInfo.isOwner,
    itemOwnerId: input.authInfo.ownerId
  });
  if (!validation.valid) {
    return {
      auditReason: validation.reason ?? 'acl_semantics_rejected',
      kind: 'denied',
      resultStatus: 'aclDenied',
      warningEntry: buildAclAuditEntry(
        input.operation,
        input.actorId,
        'denied',
        validation.reason
      )
    };
  }

  const normalizedAclOperation = normalizeAclOperation(input.operation);
  if (!normalizedAclOperation) {
    if (input.operation.encryptedPayload) {
      return {
        kind: 'allowed',
        operationToPersist: input.operation
      };
    }

    return {
      auditReason: 'acl_fields_invalid',
      kind: 'denied',
      resultStatus: 'invalidOp'
    };
  }

  const aclTargetStateKey = [
    normalizedAclOperation.itemId,
    normalizedAclOperation.principalType,
    normalizedAclOperation.principalId
  ].join(':');
  const cachedAclTargetState = input.aclTargetStateCache.get(aclTargetStateKey);
  const aclTargetState =
    cachedAclTargetState ??
    (await loadAclTargetState(input.runQuery, {
      itemId: normalizedAclOperation.itemId,
      itemOwnerId:
        input.itemOwnersById.get(normalizedAclOperation.itemId)?.owner_id ??
        null,
      principalType: normalizedAclOperation.principalType,
      principalId: normalizedAclOperation.principalId
    }));
  if (!cachedAclTargetState) {
    input.aclTargetStateCache.set(aclTargetStateKey, aclTargetState);
  }

  const actorAccessRank =
    input.actorAccessRanksByItemId.get(normalizedAclOperation.itemId) ?? 0;
  const itemOwnerId =
    input.itemOwnersById.get(normalizedAclOperation.itemId)?.owner_id ?? null;
  if (
    !isAclMutationAuthorized({
      actorAccessRank,
      actorId: input.actorId,
      itemOwnerId,
      operation: normalizedAclOperation,
      targetState: aclTargetState
    })
  ) {
    return {
      auditReason: 'acl_semantics_rejected',
      kind: 'denied',
      resultStatus: 'aclDenied',
      warningEntry: buildAclAuditEntry(
        input.operation,
        input.actorId,
        'denied',
        'acl_semantics_rejected'
      )
    };
  }

  return {
    kind: 'allowed',
    operationToPersist: normalizedAclOperation
  };
}

export function parseAccessRank(value: number | string | null): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsedValue = Number.parseInt(value, 10);
    if (Number.isInteger(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
  }

  return 0;
}
