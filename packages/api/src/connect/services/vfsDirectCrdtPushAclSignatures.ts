import {
  base64ToBytes,
  verifyAclOperationSignature,
  type VfsCrdtPushOperation
} from '@tearleads/shared';
import type { QueryResultRow } from 'pg';
import { normalizeRequiredString } from './vfsDirectBlobShared.js';
import { isAclOperation } from './vfsDirectCrdtPushAclGuardrails.js';
import type { TimedQueryRunner } from './vfsDirectCrdtPushApplyHelpers.js';

interface ActorSigningKeyRow extends QueryResultRow {
  public_signing_key: string | null;
}

export type VerifyAclPushOperationSignatureResult =
  | { ok: true }
  | { ok: false; reason: string };

function toAclSigningFields(operation: VfsCrdtPushOperation): {
  opId: string;
  opType: 'acl_add' | 'acl_remove';
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  principalType: string;
  principalId: string;
  accessLevel: string;
} | null {
  if (!isAclOperation(operation)) {
    return null;
  }

  const principalType = normalizeRequiredString(operation.principalType);
  const principalId = normalizeRequiredString(operation.principalId);

  if (!principalType || !principalId) {
    return null;
  }

  if (operation.opType === 'acl_add') {
    const accessLevel = normalizeRequiredString(operation.accessLevel);
    if (!accessLevel) {
      return null;
    }

    return {
      opId: operation.opId,
      opType: operation.opType,
      itemId: operation.itemId,
      replicaId: operation.replicaId,
      writeId: operation.writeId,
      occurredAt: operation.occurredAt,
      principalType,
      principalId,
      accessLevel
    };
  }

  return {
    opId: operation.opId,
    opType: operation.opType,
    itemId: operation.itemId,
    replicaId: operation.replicaId,
    writeId: operation.writeId,
    occurredAt: operation.occurredAt,
    principalType,
    principalId,
    accessLevel: ''
  };
}

async function loadActorPublicSigningKey(input: {
  actorId: string;
  cachedPublicSigningKeys: Map<string, Uint8Array | null>;
  runQuery: TimedQueryRunner;
}): Promise<Uint8Array | null> {
  if (input.cachedPublicSigningKeys.has(input.actorId)) {
    return input.cachedPublicSigningKeys.get(input.actorId) ?? null;
  }

  const result = await input.runQuery<ActorSigningKeyRow>(
    'actor_signing_key_lookup',
    `
    SELECT public_signing_key
    FROM user_keys
    WHERE user_id = $1::uuid
    LIMIT 1
    `,
    [input.actorId]
  );

  const publicSigningKey = normalizeRequiredString(
    result.rows[0]?.public_signing_key
  );
  const decodedPublicSigningKey = publicSigningKey
    ? base64ToBytes(publicSigningKey)
    : null;
  const normalizedPublicSigningKey =
    decodedPublicSigningKey && decodedPublicSigningKey.length > 0
      ? decodedPublicSigningKey
      : null;

  input.cachedPublicSigningKeys.set(
    input.actorId,
    normalizedPublicSigningKey
  );
  return normalizedPublicSigningKey;
}

export async function verifyAclPushOperationSignature(input: {
  actorId: string;
  cachedPublicSigningKeys: Map<string, Uint8Array | null>;
  operation: VfsCrdtPushOperation;
  runQuery: TimedQueryRunner;
}): Promise<VerifyAclPushOperationSignatureResult> {
  if (!isAclOperation(input.operation)) {
    return { ok: true };
  }

  const operationSignature = normalizeRequiredString(
    input.operation.operationSignature
  );
  if (!operationSignature) {
    return { ok: false, reason: 'acl_signature_missing' };
  }

  const signingFields = toAclSigningFields(input.operation);
  if (!signingFields) {
    return { ok: false, reason: 'acl_signature_fields_invalid' };
  }

  const actorPublicSigningKey = await loadActorPublicSigningKey(input);
  if (!actorPublicSigningKey) {
    return { ok: false, reason: 'actor_signing_key_missing' };
  }

  const signatureValid = verifyAclOperationSignature(
    signingFields,
    operationSignature,
    actorPublicSigningKey
  );
  if (!signatureValid) {
    return { ok: false, reason: 'acl_signature_invalid' };
  }

  return { ok: true };
}
