/**
 * Client-side ACL operation signature verification on pull.
 *
 * Verifies Ed25519 signatures on pulled ACL operations using the
 * actor's public signing key delivered alongside the operation.
 * Integrates with the TOFU key store to detect key substitution.
 */

import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { base64ToBytes, verifyAclOperationSignature } from '@tearleads/shared';
import type { VfsAclTofuKeyStore } from './syncClientAclKeyStore.js';

export type VfsAclVerificationFailureReason =
  | 'missing_signature'
  | 'missing_public_key'
  | 'invalid_public_key'
  | 'invalid_signature'
  | 'tofu_key_conflict'
  | 'missing_signing_fields';

export interface VfsAclVerificationFailure {
  opId: string;
  actorId: string | null;
  reason: VfsAclVerificationFailureReason;
}

export type VfsAclVerificationHandler = (
  failure: VfsAclVerificationFailure
) => void;

const CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';
const ED25519_PUBLIC_KEY_LENGTH = 32;

/**
 * Parse replicaId and writeId from the source_id field.
 *
 * For client-pushed operations, source_id follows the format:
 * `userId:replicaId:writeId:opId`
 */
function parseSigningFieldsFromSourceId(
  sourceTable: string,
  sourceId: string
): { replicaId: string; writeId: number } | null {
  if (sourceTable !== CLIENT_PUSH_SOURCE_TABLE) {
    return null;
  }

  const firstColon = sourceId.indexOf(':');
  if (firstColon < 0) {
    return null;
  }

  const afterUserId = sourceId.substring(firstColon + 1);
  const secondColon = afterUserId.indexOf(':');
  if (secondColon < 0) {
    return null;
  }

  const replicaId = afterUserId.substring(0, secondColon);
  const afterReplicaId = afterUserId.substring(secondColon + 1);
  const thirdColon = afterReplicaId.indexOf(':');
  if (thirdColon < 0) {
    return null;
  }

  const writeIdStr = afterReplicaId.substring(0, thirdColon);
  const writeId = Number.parseInt(writeIdStr, 10);
  if (!Number.isFinite(writeId) || writeId < 0) {
    return null;
  }

  return { replicaId, writeId };
}

function isAclOperation(item: VfsCrdtSyncItem): boolean {
  return item.opType === 'acl_add' || item.opType === 'acl_remove';
}

/**
 * Verify ACL operation signatures on a page of pulled sync items.
 *
 * Non-ACL operations are skipped. ACL operations must have both
 * `operationSignature` and `actorSigningPublicKey` to pass verification.
 *
 * @returns The number of verification failures detected.
 */
export function verifyPullAclSignatures(input: {
  items: readonly VfsCrdtSyncItem[];
  tofuKeyStore: VfsAclTofuKeyStore | null;
  onVerificationFailure: VfsAclVerificationHandler | null;
}): number {
  let failureCount = 0;

  for (const item of input.items) {
    if (!isAclOperation(item)) {
      continue;
    }

    const failure = verifySingleAclItem(item, input.tofuKeyStore);
    if (failure) {
      failureCount += 1;
      if (input.onVerificationFailure) {
        input.onVerificationFailure(failure);
      }
    }
  }

  return failureCount;
}

function verifySingleAclItem(
  item: VfsCrdtSyncItem,
  tofuKeyStore: VfsAclTofuKeyStore | null
): VfsAclVerificationFailure | null {
  const signature = item.operationSignature;
  if (!signature) {
    return {
      opId: item.opId,
      actorId: item.actorId,
      reason: 'missing_signature'
    };
  }

  const publicKeyBase64 = item.actorSigningPublicKey;
  if (!publicKeyBase64) {
    return {
      opId: item.opId,
      actorId: item.actorId,
      reason: 'missing_public_key'
    };
  }

  if (tofuKeyStore && item.actorId) {
    const keyAccepted = tofuKeyStore.verifyOrPin(item.actorId, publicKeyBase64);
    if (!keyAccepted) {
      return {
        opId: item.opId,
        actorId: item.actorId,
        reason: 'tofu_key_conflict'
      };
    }
  }

  const publicKeyBytes = base64ToBytes(publicKeyBase64);
  if (!publicKeyBytes || publicKeyBytes.length !== ED25519_PUBLIC_KEY_LENGTH) {
    return {
      opId: item.opId,
      actorId: item.actorId,
      reason: 'invalid_public_key'
    };
  }

  const signingFields = parseSigningFieldsFromSourceId(
    item.sourceTable,
    item.sourceId
  );
  if (!signingFields) {
    return {
      opId: item.opId,
      actorId: item.actorId,
      reason: 'missing_signing_fields'
    };
  }

  const valid = verifyAclOperationSignature(
    {
      opId: item.opId,
      opType: item.opType,
      itemId: item.itemId,
      replicaId: signingFields.replicaId,
      writeId: signingFields.writeId,
      occurredAt: item.occurredAt,
      principalType: item.principalType ?? '',
      principalId: item.principalId ?? '',
      accessLevel: item.opType === 'acl_remove' ? '' : (item.accessLevel ?? '')
    },
    signature,
    publicKeyBytes
  );

  if (!valid) {
    return {
      opId: item.opId,
      actorId: item.actorId,
      reason: 'invalid_signature'
    };
  }

  return null;
}
