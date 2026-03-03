import { randomUUID } from 'node:crypto';

import type { DbQueryClient } from './setupBobNotesShareForAliceDb.js';

export interface SetupWelcomeEmailsDbInput {
  client: DbQueryClient;
  bobEmail: string;
  aliceEmail: string;
  idFactory?: () => string;
  now?: () => Date;
}

export interface UserEmailResult {
  userId: string;
  inboxFolderId: string;
  emailItemId: string;
}

export interface SetupWelcomeEmailsDbResult {
  bob: UserEmailResult;
  alice: UserEmailResult;
}

const WELCOME_SUBJECT = 'Welcome to Tearleads';
const WELCOME_FROM = 'system@tearleads.com';
const WELCOME_BODY_PATH = 'scaffolding://welcome-email-body';

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function readRequiredUserId(
  rows: Array<{ id?: unknown }>,
  email: string
): string {
  const userId = rows[0]?.id;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error(`Could not resolve user id for ${email}`);
  }
  return userId;
}

async function insertEmailForUser(
  client: DbQueryClient,
  userId: string,
  userEmail: string,
  inboxFolderId: string,
  emailItemId: string,
  idFactory: () => string,
  nowIso: string
): Promise<void> {
  await client.query(
    `INSERT INTO vfs_registry (
       id,
       object_type,
       owner_id,
       encrypted_name,
       created_at
     )
     VALUES ($1, 'emailFolder', $2, 'Inbox', $3::timestamptz)
     ON CONFLICT (id) DO UPDATE
     SET encrypted_name = 'Inbox'`,
    [inboxFolderId, userId, nowIso]
  );

  await client.query(
    `INSERT INTO vfs_registry (
       id,
       object_type,
       owner_id,
       encrypted_session_key,
       created_at
     )
     VALUES ($1, 'email', $2, $3, $4::timestamptz)`,
    [emailItemId, userId, 'scaffolding-email-session-key', nowIso]
  );

  await client.query(
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
     )
     VALUES ($1, $2, $3, $4::json, $5::json, $6, $7, $8::timestamptz, false, false)`,
    [
      emailItemId,
      encodeBase64(WELCOME_SUBJECT),
      encodeBase64(WELCOME_FROM),
      JSON.stringify([encodeBase64(userEmail)]),
      JSON.stringify([]),
      WELCOME_BODY_PATH,
      0,
      nowIso
    ]
  );

  await client.query(
    `INSERT INTO vfs_links (
       id,
       parent_id,
       child_id,
       wrapped_session_key,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5::timestamptz)
     ON CONFLICT (parent_id, child_id) DO NOTHING`,
    [
      randomUUID(),
      inboxFolderId,
      emailItemId,
      'scaffolding-link-wrap',
      nowIso
    ]
  );

  await client.query(
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
     )
     VALUES (
       $1, $2, 'user', $3, 'read', $4,
       NULL, NULL, NULL,
       $5::timestamptz, $5::timestamptz, NULL, NULL
     )
     ON CONFLICT (item_id, principal_type, principal_id) DO UPDATE SET
       access_level = EXCLUDED.access_level,
       wrapped_session_key = EXCLUDED.wrapped_session_key,
       updated_at = EXCLUDED.updated_at`,
    [
      `acl:${idFactory()}`,
      emailItemId,
      userId,
      'scaffolding-email-acl-wrap',
      nowIso
    ]
  );
}

export async function setupWelcomeEmailsDb(
  input: SetupWelcomeEmailsDbInput
): Promise<SetupWelcomeEmailsDbResult> {
  const idFactory = input.idFactory ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const nowIso = now().toISOString();

  await input.client.query('BEGIN');
  try {
    const bobRows = await input.client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [input.bobEmail]
    );
    const aliceRows = await input.client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [input.aliceEmail]
    );
    const bobUserId = readRequiredUserId(bobRows.rows, input.bobEmail);
    const aliceUserId = readRequiredUserId(aliceRows.rows, input.aliceEmail);

    const bobInboxId = `email-inbox:${bobUserId}`;
    const bobEmailItemId = `email:${idFactory()}`;
    await insertEmailForUser(
      input.client,
      bobUserId,
      input.bobEmail,
      bobInboxId,
      bobEmailItemId,
      idFactory,
      nowIso
    );

    const aliceInboxId = `email-inbox:${aliceUserId}`;
    const aliceEmailItemId = `email:${idFactory()}`;
    await insertEmailForUser(
      input.client,
      aliceUserId,
      input.aliceEmail,
      aliceInboxId,
      aliceEmailItemId,
      idFactory,
      nowIso
    );

    await input.client.query('COMMIT');

    return {
      bob: {
        userId: bobUserId,
        inboxFolderId: bobInboxId,
        emailItemId: bobEmailItemId
      },
      alice: {
        userId: aliceUserId,
        inboxFolderId: aliceInboxId,
        emailItemId: aliceEmailItemId
      }
    };
  } catch (error) {
    await input.client.query('ROLLBACK');
    throw error;
  }
}
