import type { VfsCrdtPushOperation } from '@tearleads/shared';

const ACCESS_RANK_READ = 1;
const ACCESS_RANK_WRITE = 2;
const ACCESS_RANK_ADMIN = 3;

export interface AclValidationContext {
  actorId: string;
  actorAccessRank: number;
  isItemOwner: boolean;
  itemOwnerId: string | null;
}

export interface AclValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Maps access level strings to their numeric rank.
 * read=1, write=2, admin=3.
 */
function accessLevelToRank(level: string): number {
  switch (level) {
    case 'read':
      return ACCESS_RANK_READ;
    case 'write':
      return ACCESS_RANK_WRITE;
    case 'admin':
      return ACCESS_RANK_ADMIN;
    default:
      return 0;
  }
}

export function validateAclOperationSemantics(
  operation: VfsCrdtPushOperation,
  context: AclValidationContext
): AclValidationResult {
  const { opType, principalType, principalId, accessLevel } = operation;

  if (opType !== 'acl_add' && opType !== 'acl_remove') {
    return { valid: true };
  }

  // Skip semantic validation for encrypted ACL operations (server cannot
  // inspect encrypted fields). Field integrity for encrypted operations is
  // already enforced at the parse layer.
  if (operation.encryptedPayload) {
    return { valid: true };
  }

  // --- Field integrity checks ---

  if (opType === 'acl_remove' && accessLevel != null) {
    return {
      valid: false,
      reason: 'acl_remove must not carry an accessLevel'
    };
  }

  if (opType === 'acl_add' && !accessLevel) {
    return {
      valid: false,
      reason: 'acl_add requires an accessLevel'
    };
  }

  if (!principalType || !principalId) {
    return {
      valid: false,
      reason: 'ACL operation requires principalType and principalId'
    };
  }

  // --- Semantic authorization checks ---

  const grantedRank = accessLevel ? accessLevelToRank(accessLevel) : 0;

  // Self-elevation: actor cannot grant themselves a higher access level
  if (
    opType === 'acl_add' &&
    principalType === 'user' &&
    principalId === context.actorId &&
    grantedRank > context.actorAccessRank
  ) {
    return {
      valid: false,
      reason: 'cannot elevate own access level'
    };
  }

  // Item owners retain irrevocable admin — non-owners cannot remove the owner
  if (
    opType === 'acl_remove' &&
    principalType === 'user' &&
    principalId === context.itemOwnerId &&
    !context.isItemOwner
  ) {
    return {
      valid: false,
      reason: 'cannot remove item owner access'
    };
  }

  // Only admins (rank 3) can grant or revoke admin access
  if (grantedRank === ACCESS_RANK_ADMIN) {
    if (context.actorAccessRank < ACCESS_RANK_ADMIN) {
      return {
        valid: false,
        reason: 'only admins can grant admin access'
      };
    }
  }

  if (opType === 'acl_remove') {
    // Only admins can revoke other users' access (owners are implicitly admin)
    if (context.actorAccessRank < ACCESS_RANK_ADMIN) {
      return {
        valid: false,
        reason: 'only admins can revoke access'
      };
    }
  }

  // Writers (rank 2) can only grant read access
  if (
    opType === 'acl_add' &&
    context.actorAccessRank === ACCESS_RANK_WRITE &&
    grantedRank > ACCESS_RANK_READ
  ) {
    return {
      valid: false,
      reason: 'writers can only grant read access'
    };
  }

  // Read-only users (rank 1) cannot issue any ACL mutations
  if (context.actorAccessRank < ACCESS_RANK_WRITE) {
    return {
      valid: false,
      reason: 'insufficient access level for ACL operations'
    };
  }

  return { valid: true };
}

export interface AclAuditEntry {
  action: 'acl_mutation';
  opType: string;
  opId: string;
  itemId: string;
  actorId: string;
  principalType: string | undefined;
  principalId: string | undefined;
  accessLevel: string | undefined;
  occurredAt: string;
  result: 'applied' | 'denied';
  denialReason: string | undefined;
}

export function buildAclAuditEntry(
  operation: VfsCrdtPushOperation,
  actorId: string,
  result: 'applied' | 'denied',
  denialReason?: string
): AclAuditEntry {
  return {
    action: 'acl_mutation',
    opType: operation.opType,
    opId: operation.opId,
    itemId: operation.itemId,
    actorId,
    principalType: operation.principalType,
    principalId: operation.principalId,
    accessLevel: operation.accessLevel,
    occurredAt: operation.occurredAt,
    result,
    denialReason: denialReason ?? undefined
  };
}
