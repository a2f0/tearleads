import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { base64ToBytes, verifyAclOperationSignature } from '@tearleads/shared';

/**
 * Parse replicaId and writeId from the `sourceId` field.
 *
 * sourceId format: `${userId}:${replicaId}:${writeId}:${opId}`
 */
function parseSourceId(
  sourceId: string
): { replicaId: string; writeId: number } | null {
  const parts = sourceId.split(':');
  if (parts.length < 4) {
    return null;
  }

  const replicaId = parts[1];
  const writeIdStr = parts[2];
  if (!replicaId || !writeIdStr) {
    return null;
  }

  const writeId = Number.parseInt(writeIdStr, 10);
  if (!Number.isFinite(writeId) || writeId < 1) {
    return null;
  }

  return { replicaId, writeId };
}

export interface AclVerificationResult {
  verified: boolean;
  reason?: string;
}

/**
 * Verify the Ed25519 signature on a pulled ACL sync item.
 *
 * Returns `{ verified: true }` when the signature is valid, or
 * `{ verified: false, reason }` when verification fails or cannot
 * be performed (missing fields, invalid public key, etc.).
 *
 * Non-ACL operations and unsigned ACL operations return
 * `{ verified: true }` — only signed ACL operations are validated.
 */
export function verifyPulledAclItemSignature(
  item: VfsCrdtSyncItem
): AclVerificationResult {
  if (item.opType !== 'acl_add' && item.opType !== 'acl_remove') {
    return { verified: true };
  }

  if (!item.operationSignature) {
    return { verified: true };
  }

  if (!item.actorSigningPublicKey) {
    return { verified: false, reason: 'missing actorSigningPublicKey' };
  }

  const parsed = parseSourceId(item.sourceId);
  if (!parsed) {
    return { verified: false, reason: 'cannot parse sourceId' };
  }

  const publicKey = base64ToBytes(item.actorSigningPublicKey);
  if (!publicKey) {
    return { verified: false, reason: 'invalid public key encoding' };
  }
  if (publicKey.length !== 32) {
    return { verified: false, reason: 'invalid public key length' };
  }

  const valid = verifyAclOperationSignature(
    {
      opId: item.opId,
      opType: item.opType,
      itemId: item.itemId,
      replicaId: parsed.replicaId,
      writeId: parsed.writeId,
      occurredAt: item.occurredAt,
      principalType: item.principalType ?? '',
      principalId: item.principalId ?? '',
      accessLevel: item.opType === 'acl_add' ? (item.accessLevel ?? '') : ''
    },
    item.operationSignature,
    publicKey
  );

  if (!valid) {
    return { verified: false, reason: 'signature verification failed' };
  }

  return { verified: true };
}
