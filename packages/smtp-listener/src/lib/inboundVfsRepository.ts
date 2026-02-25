import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  InboundMessageEnvelopeRecord,
  InboundVfsEmailRepository,
  ResolvedInboundRecipient,
  WrappedRecipientKeyEnvelope
} from '../types/inboundContracts.js';
import { getPostgresPool } from './postgres.js';

interface InboxRow {
  id: string;
}

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

async function ensureInboxFolder(
  client: PoolClient,
  userId: string
): Promise<string> {
  const existing = await client.query<InboxRow>(
    `SELECT ef.id
     FROM email_folders ef
     INNER JOIN vfs_registry vr ON vr.id = ef.id
     WHERE vr.owner_id = $1
       AND ef.folder_type = 'inbox'
     LIMIT 1`,
    [userId]
  );
  const existingRow = existing.rows[0];
  if (existingRow?.id) {
    return existingRow.id;
  }

  const folderId = randomUUID();
  await client.query(
    `INSERT INTO vfs_registry (id, object_type, owner_id, created_at)
     VALUES ($1, 'emailFolder', $2, NOW())`,
    [folderId, userId]
  );
  await client.query(
    `INSERT INTO email_folders (id, encrypted_name, folder_type, unread_count)
     VALUES ($1, $2, 'inbox', 0)`,
    [folderId, 'inbox']
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
       encrypted_session_key,
       created_at
     ) VALUES (
       $1,
       'email',
       $2,
       $3,
       NOW()
     )`,
    [emailItemId, input.recipient.userId, input.wrappedKey.wrappedDek]
  );

  await input.client.query(
    `INSERT INTO emails (
       id,
       encrypted_subject,
       encrypted_from,
       encrypted_to,
       encrypted_cc,
       encrypted_body_path,
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
       $7::timestamptz,
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
      await client.query(
        `INSERT INTO email_messages (
           id,
           storage_key,
           sha256,
           ciphertext_size,
           ciphertext_content_type,
           content_encryption_algorithm,
           created_at
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           'message/rfc822',
           'aes-256-gcm',
           NOW()
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          input.envelope.messageId,
          input.envelope.encryptedBodyPointer,
          input.envelope.encryptedBodySha256,
          input.envelope.encryptedBodySize
        ]
      );

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

        const inboxFolderId = await ensureInboxFolder(client, recipient.userId);

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
