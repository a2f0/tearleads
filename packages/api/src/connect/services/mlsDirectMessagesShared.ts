import type { QueryResultRow } from 'pg';
import { serializeEnvelopeField } from './vfsDirectCrdtEnvelopeStorage.js';

export type MlsSourceTable = 'mls_message' | 'mls_commit';

export interface VfsMirrorInput {
  messageId: string;
  groupId: string;
  organizationId: string;
  senderUserId: string;
  ciphertext: Uint8Array;
  contentType: string;
  epoch: number;
  occurredAtIso: string;
  sequenceNumber: number;
  sourceTable?: MlsSourceTable;
}

export interface QueryClient {
  query: <T extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
  release: () => void;
}

interface TransactionPool {
  connect: () => Promise<{
    query: <T extends QueryResultRow = QueryResultRow>(
      queryText: string,
      values?: unknown[]
    ) => Promise<{ rows: T[]; rowCount: number | null }>;
    release: () => void;
  }>;
}

export interface GroupMaxSequenceRow {
  sequence_number: string | number | null;
}

export interface GroupMessageRow {
  id: string;
  group_id: string;
  sender_user_id: string | null;
  epoch: number;
  ciphertext_bytes: Buffer | Uint8Array | null;
  ciphertext_text: string | null;
  encoded_content_type: string | null;
  sequence_number: number;
  created_at: Date | string;
  sender_email: string | null;
}

export function toPositiveInteger(value: string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 0;
}

export function encodeContentTypeForSourceId(contentType: string): string {
  return encodeURIComponent(contentType);
}

export function decodeContentTypeFromSourceId(
  encodedContentType: string | null
): string {
  if (!encodedContentType) {
    return 'text/plain';
  }

  try {
    const decoded = decodeURIComponent(encodedContentType);
    return decoded.trim() === '' ? 'text/plain' : decoded;
  } catch {
    return 'text/plain';
  }
}

export function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export async function acquireTransactionClient(
  pool: TransactionPool
): Promise<QueryClient> {
  const client = await pool.connect();
  return {
    query: <T extends QueryResultRow = QueryResultRow>(
      queryText: string,
      values?: unknown[]
    ) => client.query<T>(queryText, values),
    release: () => client.release()
  };
}

export async function persistMlsMessageToVfs(
  client: QueryClient,
  input: VfsMirrorInput
): Promise<void> {
  const ciphertext = serializeEnvelopeField(input.ciphertext);
  const sourceTable = input.sourceTable ?? 'mls_message';

  await client.query(
    `
    INSERT INTO vfs_registry (
      id,
      object_type,
      owner_id,
      organization_id,
      created_at
    ) VALUES (
      $1::uuid,
      'mlsMessage',
      NULL,
      $2::uuid,
      $3::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [input.messageId, input.organizationId, input.occurredAtIso]
  );

  await client.query(
    `
    INSERT INTO vfs_item_state (
      item_id,
      encrypted_payload,
      key_epoch,
      updated_at,
      deleted_at
    ) VALUES (
      $1::uuid,
      $2::text,
      $3::integer,
      $4::timestamptz,
      NULL
    )
    ON CONFLICT (item_id) DO UPDATE
    SET
      encrypted_payload = EXCLUDED.encrypted_payload,
      key_epoch = EXCLUDED.key_epoch,
      updated_at = EXCLUDED.updated_at,
      deleted_at = NULL
    `,
    [input.messageId, ciphertext.text, input.epoch, input.occurredAtIso]
  );

  await client.query(
    `
    INSERT INTO vfs_acl_entries (
      id,
      item_id,
      principal_type,
      principal_id,
      access_level,
      granted_by,
      created_at,
      updated_at,
      revoked_at,
      expires_at
    )
    SELECT
      vfs_make_event_id('acl'),
      $1::uuid,
      'user',
      member.user_id,
      'read',
      $2::uuid,
      $3::timestamptz,
      $3::timestamptz,
      NULL,
      NULL
    FROM mls_group_members member
    WHERE member.group_id = $4::uuid
      AND member.removed_at IS NULL
    ON CONFLICT (item_id, principal_type, principal_id) DO UPDATE
    SET
      access_level = EXCLUDED.access_level,
      granted_by = EXCLUDED.granted_by,
      updated_at = EXCLUDED.updated_at,
      revoked_at = NULL,
      expires_at = NULL
    `,
    [input.messageId, input.senderUserId, input.occurredAtIso, input.groupId]
  );

  await client.query(
    `
    INSERT INTO vfs_crdt_ops (
      id,
      item_id,
      op_type,
      actor_id,
      source_table,
      source_id,
      occurred_at,
      encrypted_payload,
      encrypted_payload_bytes,
      key_epoch
    ) VALUES (
      vfs_make_event_id('crdt'),
      $1::uuid,
      'item_upsert',
      $2::uuid,
      $8::text,
      $3::text,
      $4::timestamptz,
      $5::text,
      $6::bytea,
      $7::integer
    )
    `,
    [
      input.messageId,
      input.senderUserId,
      `${sourceTable}:${input.groupId}:${input.sequenceNumber}:${input.messageId}:${encodeContentTypeForSourceId(input.contentType)}`,
      input.occurredAtIso,
      ciphertext.text,
      ciphertext.bytes,
      input.epoch,
      sourceTable
    ]
  );
}
