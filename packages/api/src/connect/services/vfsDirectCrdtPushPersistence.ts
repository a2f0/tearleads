import type { VfsCrdtPushOperation } from '@tearleads/shared';
import { serializeEnvelopeField } from './vfsDirectCrdtEnvelopeStorage.js';
import {
  resolveContainerId,
  type TimedQueryRunner
} from './vfsDirectCrdtPushApplyHelpers.js';
import { CRDT_CLIENT_PUSH_SOURCE_TABLE } from './vfsDirectCrdtPushCanonical.js';

export interface InsertedCrdtOpRow {
  id: string;
  occurred_at: Date | string;
}

export async function insertCrdtOperation(input: {
  actorId: string;
  canonicalOccurredAt: string;
  operation: VfsCrdtPushOperation;
  runQuery: TimedQueryRunner;
  sourceId: string;
}): Promise<{
  rowCount: number | null;
  rows: InsertedCrdtOpRow[];
}> {
  const encryptedPayload = serializeEnvelopeField(input.operation.encryptedPayload);
  const encryptionNonce = serializeEnvelopeField(input.operation.encryptionNonce);
  const encryptionAad = serializeEnvelopeField(input.operation.encryptionAad);
  const encryptionSignature = serializeEnvelopeField(
    input.operation.encryptionSignature
  );
  const operationSignature = serializeEnvelopeField(
    input.operation.operationSignature
  );

  return input.runQuery<InsertedCrdtOpRow>(
    'insert_crdt_op',
    `
    INSERT INTO vfs_crdt_ops (
      id,
      item_id,
      op_type,
      principal_type,
      principal_id,
      access_level,
      parent_id,
      child_id,
      actor_id,
      source_table,
      source_id,
      occurred_at,
      encrypted_payload,
      key_epoch,
      encryption_nonce,
      encryption_aad,
      encryption_signature,
      operation_signature,
      encrypted_payload_bytes,
      encryption_nonce_bytes,
      encryption_aad_bytes,
      encryption_signature_bytes,
      operation_signature_bytes,
      root_id
    ) VALUES (
      vfs_make_event_id('crdt'),
      $1::uuid,
      $2::text,
      $3::text,
      $4::uuid,
      $5::text,
      $6::uuid,
      $7::uuid,
      $8::uuid,
      $9::text,
      $10::text,
      $11::timestamptz,
      $12::text,
      $13::integer,
      $14::text,
      $15::text,
      $16::text,
      $17::text,
      $18::bytea,
      $19::bytea,
      $20::bytea,
      $21::bytea,
      $22::bytea,
      $23::uuid
    )
    RETURNING id, occurred_at
    `,
    [
      input.operation.itemId,
      input.operation.opType,
      input.operation.principalType ?? null,
      input.operation.principalId ?? null,
      input.operation.accessLevel ?? null,
      input.operation.parentId ?? null,
      input.operation.childId ?? null,
      input.actorId,
      CRDT_CLIENT_PUSH_SOURCE_TABLE,
      input.sourceId,
      input.canonicalOccurredAt,
      encryptedPayload.text,
      input.operation.keyEpoch ?? null,
      encryptionNonce.text,
      encryptionAad.text,
      encryptionSignature.text,
      operationSignature.text,
      encryptedPayload.bytes,
      encryptionNonce.bytes,
      encryptionAad.bytes,
      encryptionSignature.bytes,
      operationSignature.bytes,
      resolveContainerId(input.operation)
    ]
  );
}
