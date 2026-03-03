import type { QueryResultRow } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { serializeEnvelopeField } from '../../routes/vfs/crdtEnvelopeStorage.js';

export interface VfsMirrorInput {
  messageId: string;
  groupId: string;
  senderUserId: string;
  ciphertext: string;
  contentType: string;
  epoch: number;
  occurredAtIso: string;
  sequenceNumber: number;
}

export interface QueryClient {
  query: <T extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
  release: () => void;
}

export interface GroupMaxSequenceRow {
  sequence_number: string | number | null;
}

export interface GroupMessageRow {
  id: string;
  group_id: string;
  sender_user_id: string | null;
  epoch: number;
  ciphertext: string;
  encoded_content_type: string | null;
  legacy_content_type: string | null;
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
  encodedContentType: string | null,
  fallbackContentType: string | null
): string {
  if (!encodedContentType) {
    if (!fallbackContentType || fallbackContentType.trim() === '') {
      return 'text/plain';
    }

    return fallbackContentType;
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
  pool: Awaited<ReturnType<typeof getPostgresPool>>
): Promise<QueryClient> {
  if (typeof pool.connect !== 'function') {
    return {
      query: <T extends QueryResultRow = QueryResultRow>(
        queryText: string,
        values?: unknown[]
      ) => pool.query<T>(queryText, values),
      release: () => {}
    };
  }

  const client = await pool.connect();
  return {
    query: <T extends QueryResultRow = QueryResultRow>(
      queryText: string,
      values?: unknown[]
    ) => client.query<T>(queryText, values),
    release: () => client.release()
  };
}

export async function persistApplicationMessageToVfs(
  client: QueryClient,
  input: VfsMirrorInput
): Promise<void> {
  const ciphertext = serializeEnvelopeField(input.ciphertext);

  await client.query(
    `
    INSERT INTO vfs_registry (
      id,
      object_type,
      owner_id,
      created_at
    ) VALUES (
      $1::text,
      'mlsMessage',
      NULL,
      $2::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [input.messageId, input.occurredAtIso]
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
      $1::text,
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
    [input.messageId, input.ciphertext, input.epoch, input.occurredAtIso]
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
      $1::text,
      'user',
      member.user_id,
      'read',
      $2::text,
      $3::timestamptz,
      $3::timestamptz,
      NULL,
      NULL
    FROM mls_group_members member
    WHERE member.group_id = $4::text
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
      $1::text,
      'item_upsert',
      $2::text,
      'mls_message',
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
      `mls_message:${input.groupId}:${input.sequenceNumber}:${input.messageId}:${encodeContentTypeForSourceId(input.contentType)}`,
      input.occurredAtIso,
      ciphertext.text,
      ciphertext.bytes,
      input.epoch
    ]
  );
}
