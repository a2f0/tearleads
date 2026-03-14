import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtPushOperation,
  VfsCrdtPushResult
} from '@tearleads/shared';
import type { QueryResultRow } from 'pg';
import {
  isAccessLevel,
  isPrincipalType
} from '../../lib/vfsCrdtSnapshotCommon.js';
import { normalizeRequiredString } from './vfsDirectBlobShared.js';
import type { TimedQueryRunner } from './vfsDirectCrdtPushApplyHelpers.js';

interface ActiveAclEntryRow extends QueryResultRow {
  access_level: string | null;
}

interface NormalizedAclBaseOperation {
  opId: string;
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
}

interface NormalizedAclAddOperation extends NormalizedAclBaseOperation {
  opType: 'acl_add';
  accessLevel: VfsAclAccessLevel;
}

interface NormalizedAclRemoveOperation extends NormalizedAclBaseOperation {
  opType: 'acl_remove';
}

export type NormalizedAclOperation =
  | NormalizedAclAddOperation
  | NormalizedAclRemoveOperation;

export interface AclTargetState {
  accessLevel: VfsAclAccessLevel | null;
  isItemOwner: boolean;
}

function normalizeAclBaseOperation(
  operation: VfsCrdtPushOperation
): NormalizedAclBaseOperation | null {
  if (operation.opType !== 'acl_add' && operation.opType !== 'acl_remove') {
    return null;
  }

  const opId = normalizeRequiredString(operation.opId);
  const itemId = normalizeRequiredString(operation.itemId);
  const replicaId = normalizeRequiredString(operation.replicaId);
  const occurredAt = normalizeRequiredString(operation.occurredAt);
  const principalType = isPrincipalType(operation.principalType)
    ? operation.principalType
    : null;
  const principalId = normalizeRequiredString(operation.principalId);

  if (
    !opId ||
    !itemId ||
    !replicaId ||
    !occurredAt ||
    !principalType ||
    !principalId ||
    !Number.isSafeInteger(operation.writeId) ||
    operation.writeId < 1
  ) {
    return null;
  }

  return {
    opId,
    itemId,
    replicaId,
    writeId: operation.writeId,
    occurredAt,
    principalType,
    principalId
  };
}

function accessLevelToRank(level: VfsAclAccessLevel | null): number {
  if (level === 'admin') {
    return 3;
  }

  if (level === 'write') {
    return 2;
  }

  if (level === 'read') {
    return 1;
  }

  return 0;
}

export function isAclOperation(
  operation: VfsCrdtPushOperation
): operation is VfsCrdtPushOperation & {
  opType: 'acl_add' | 'acl_remove';
} {
  return operation.opType === 'acl_add' || operation.opType === 'acl_remove';
}

export function normalizeAclOperation(
  operation: VfsCrdtPushOperation
): NormalizedAclOperation | null {
  const normalizedBase = normalizeAclBaseOperation(operation);
  if (!normalizedBase) {
    return null;
  }

  if (operation.opType === 'acl_add') {
    const accessLevel = isAccessLevel(operation.accessLevel)
      ? operation.accessLevel
      : null;
    if (!accessLevel) {
      return null;
    }

    return {
      ...normalizedBase,
      opType: 'acl_add',
      accessLevel
    };
  }

  if (operation.accessLevel !== undefined && operation.accessLevel !== null) {
    return null;
  }

  return {
    ...normalizedBase,
    opType: 'acl_remove'
  };
}

export async function loadAclTargetState(
  runQuery: TimedQueryRunner,
  input: {
    itemId: string;
    itemOwnerId: string | null;
    principalType: VfsAclPrincipalType;
    principalId: string;
  }
): Promise<AclTargetState> {
  const isItemOwner =
    input.itemOwnerId !== null &&
    input.principalType === 'user' &&
    input.principalId === input.itemOwnerId;
  if (isItemOwner) {
    return {
      accessLevel: 'admin',
      isItemOwner: true
    };
  }

  const result = await runQuery<ActiveAclEntryRow>(
    'acl_target_access_lookup',
    `
    SELECT access_level
    FROM vfs_acl_entries
    WHERE item_id = $1::uuid
      AND principal_type = $2::text
      AND principal_id = $3::uuid
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
    `,
    [input.itemId, input.principalType, input.principalId]
  );
  const accessLevel = result.rows[0]?.access_level;

  return {
    accessLevel: isAccessLevel(accessLevel) ? accessLevel : null,
    isItemOwner: false
  };
}

export function isAclMutationAuthorized(input: {
  actorAccessRank: number;
  actorId: string;
  itemOwnerId: string | null;
  operation: NormalizedAclOperation;
  targetState: AclTargetState;
}): boolean {
  if (input.actorAccessRank < 2) {
    return false;
  }

  const targetAccessRank = input.targetState.isItemOwner
    ? 3
    : accessLevelToRank(input.targetState.accessLevel);
  const targetIsActor =
    input.operation.principalType === 'user' &&
    input.operation.principalId === input.actorId;

  if (input.operation.opType === 'acl_add') {
    const requestedAccessRank = accessLevelToRank(input.operation.accessLevel);

    if (targetIsActor && requestedAccessRank > input.actorAccessRank) {
      return false;
    }

    if (input.targetState.isItemOwner && requestedAccessRank < 3) {
      return false;
    }

    if (requestedAccessRank === 3 && input.actorAccessRank < 3) {
      return false;
    }

    if (input.actorAccessRank < 3) {
      if (requestedAccessRank !== 1) {
        return false;
      }

      if (targetAccessRank > 0) {
        return false;
      }
    }

    return true;
  }

  if (input.targetState.isItemOwner && input.itemOwnerId !== input.actorId) {
    return false;
  }

  if (targetAccessRank === 3 && input.actorAccessRank < 3) {
    return false;
  }

  if (targetAccessRank === 2 && input.actorAccessRank < 3 && !targetIsActor) {
    return false;
  }

  return true;
}

export function logAclMutationAudit(input: {
  actorId: string;
  organizationId: string;
  operation: VfsCrdtPushOperation;
  reason?: string | null;
  status: VfsCrdtPushResult['status'];
}): void {
  console.info(
    JSON.stringify({
      event: 'vfs_acl_mutation_audit',
      actorId: input.actorId,
      organizationId: input.organizationId,
      auditedAt: new Date().toISOString(),
      status: input.status,
      reason: input.reason ?? null,
      operation: input.operation
    })
  );
}
