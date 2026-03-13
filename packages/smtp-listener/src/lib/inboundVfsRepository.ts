import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  InboundMessageEnvelopeRecord,
  InboundVfsEmailRepository,
  ResolvedInboundRecipient,
  WrappedRecipientKeyEnvelope
} from '../types/inboundContracts.js';
import { getPostgresPool } from './postgres.js';

function findWrappedKey(
  wrappedRecipientKeys: WrappedRecipientKeyEnvelope[],
  userId: string
): WrappedRecipientKeyEnvelope | null {
  for (const entry of wrappedRecipientKeys) {
    if (entry.userId === userId) {
      return entry;
    }
  }
  return null;
}

/**
 * Derive a deterministic UUID for the user's email inbox folder.
 * Uses FNV-1a to produce 128 bits from a namespaced key, formatted as UUID v5.
 * Pure JS — no node:crypto dependency — so unit-test mocks of randomUUID
 * do not break this function.
 */
export function inboxFolderUuid(userId: string): string {
  const input = `email-inbox:${userId}`;
  const bytes = new Uint8Array(16);
  for (let b = 0; b < 16; b++) {
    let h = 2166136261 ^ Math.imul(b, 16777619);
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    bytes[b] = (h >>> 0) & 0xff;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join(
    ''
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function ensureInboxFolder(
  client: PoolClient,
  userId: string,
  organizationId: string
): Promise<string> {
  const folderId = inboxFolderUuid(userId);
  await client.query(
    `INSERT INTO vfs_registry (
       id,
       object_type,
       owner_id,
       organization_id,
       encrypted_name,
       created_at
     ) VALUES (
       $1,
       'emailFolder',
       $2,
       $3,
       'Inbox',
       NOW()
     )
     ON CONFLICT (id) DO UPDATE
     SET encrypted_name = 'Inbox',
         organization_id = EXCLUDED.organization_id`,
    [folderId, userId, organizationId]
  );
  return folderId;
}

async function insertEmailForRecipient(input: {
  client: PoolClient;
  envelope: InboundMessageEnvelopeRecord;
  recipient: ResolvedInboundRecipient;
  wrappedKey: WrappedRecipientKeyEnvelope;
  inboxFolderId: string;
}): Promise<string> {
  const emailItemId = randomUUID();
  await input.client.query(
    `INSERT INTO vfs_registry (
       id,
       object_type,
       owner_id,
       organization_id,
       encrypted_session_key,
       created_at
     ) VALUES (
       $1,
       'email',
       $2,
       $3,
       $4,
       NOW()
     )`,
    [
      emailItemId,
      input.recipient.userId,
      input.recipient.organizationId,
      input.wrappedKey.wrappedDek
    ]
  );

  await input.client.query(
    `INSERT INTO emails (
       id,
       encrypted_subject,
       encrypted_from,
       encrypted_to,
       encrypted_cc,
       encrypted_body_path,
       ciphertext_size,
       received_at,
       is_read,
       is_starred
     ) VALUES (
       $1,
       $2,
       $3,
       $4::json,
       $5::json,
       $6,
       $7,
       $8::timestamptz,
       false,
       false
     )`,
    [
      emailItemId,
      input.envelope.encryptedSubject,
      input.envelope.encryptedFrom,
      JSON.stringify(input.envelope.encryptedTo),
      JSON.stringify([]),
      input.envelope.encryptedBodyPointer,
      input.envelope.encryptedBodySize,
      input.envelope.receivedAt
    ]
  );

  await input.client.query(
    `INSERT INTO vfs_links (
       id,
       parent_id,
       child_id,
       wrapped_session_key,
       created_at
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       NOW()
     )`,
    [
      randomUUID(),
      input.inboxFolderId,
      emailItemId,
      input.wrappedKey.wrappedDek
    ]
  );

  await input.client.query(
    `INSERT INTO vfs_acl_entries (
       id,
       item_id,
       principal_type,
       principal_id,
       access_level,
       wrapped_session_key,
       wrapped_hierarchical_key,
       key_epoch,
       granted_by,
       created_at,
       updated_at,
       expires_at,
       revoked_at
     ) VALUES (
       $1,
       $2,
       'user',
       $3,
       'read',
       $4,
       NULL,
       NULL,
       NULL,
       NOW(),
       NOW(),
       NULL,
       NULL
     )`,
    [
      randomUUID(),
      emailItemId,
      input.recipient.userId,
      input.wrappedKey.wrappedDek
    ]
  );

  return emailItemId;
}

export class PostgresInboundVfsEmailRepository
  implements InboundVfsEmailRepository
{
  async persistInboundMessage(input: {
    envelope: InboundMessageEnvelopeRecord;
    recipients: ResolvedInboundRecipient[];
  }): Promise<void> {
    if (input.recipients.length === 0) {
      return;
    }

    const pool = await getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const recipient of input.recipients) {
        const wrappedKey = findWrappedKey(
          input.envelope.wrappedRecipientKeys,
          recipient.userId
        );
        if (!wrappedKey) {
          throw new Error(
            `Missing wrapped key envelope for recipient ${recipient.userId}`
          );
        }

        const inboxFolderId = await ensureInboxFolder(
          client,
          recipient.userId,
          recipient.organizationId
        );

        await insertEmailForRecipient({
          client,
          envelope: input.envelope,
          recipient,
          wrappedKey,
          inboxFolderId
        });
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
