import { randomUUID } from 'node:crypto';
import {
  type EncryptScaffoldVfsNameResult
} from './encryptScaffoldVfsName.js';
import { hasVfsRegistryOrganizationId } from './vfsRegistrySchema.js';
import {
  type DbQueryClient,
  defaultEncryptVfsName,
  encodeBase64,
  readRequiredUserId
} from './vfsScaffoldHelpers.js';

export interface SetupWelcomeEmailsDbInput {
  client: DbQueryClient;
  bobEmail: string;
  aliceEmail: string;
  encryptVfsName?: (input: {
    client: DbQueryClient;
    ownerUserId: string;
    plaintextName: string;
  }) => Promise<EncryptScaffoldVfsNameResult>;
  hasOrganizationIdColumn?: boolean;
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
export const SCAFFOLD_INLINE_EMAIL_BODY_PREFIX = 'scaffolding:inline-body:';
export const SCAFFOLD_WELCOME_EMAIL_BODY_TEXT =
  "You're all set to start exploring Tearleads.";

function buildWelcomeEmailRawMime(recipientEmail: string): string {
  return [
    `From: ${WELCOME_FROM}`,
    `To: ${recipientEmail}`,
    `Subject: ${WELCOME_SUBJECT}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    SCAFFOLD_WELCOME_EMAIL_BODY_TEXT,
    ''
  ].join('\r\n');
}

function encodeScaffoldInlineBodyCiphertext(rawMime: string): string {
  return `${SCAFFOLD_INLINE_EMAIL_BODY_PREFIX}${encodeBase64(rawMime)}`;
}

async function insertEmailForUser(
  client: DbQueryClient,
  userId: string,
  organizationId: string,
  userEmail: string,
  inboxFolderId: string,
  emailItemId: string,
  nowIso: string,
  hasOrganizationIdColumn: boolean,
  encryptVfsName: (input: {
    client: DbQueryClient;
    ownerUserId: string;
    plaintextName: string;
  }) => Promise<EncryptScaffoldVfsNameResult>
): Promise<void> {
  const rawWelcomeBody = buildWelcomeEmailRawMime(userEmail);
  const encryptedBodyPath = encodeScaffoldInlineBodyCiphertext(rawWelcomeBody);
  const ciphertextSize = Buffer.byteLength(rawWelcomeBody, 'utf8');

  const encryptedInboxName = await encryptVfsName({
    client,
    ownerUserId: userId,
    plaintextName: 'Inbox'
  });

  if (hasOrganizationIdColumn) {
    await client.query(
      `INSERT INTO vfs_registry (id, object_type, owner_id, organization_id, encrypted_session_key, encrypted_name, created_at)
       VALUES ($1::uuid, 'emailFolder', $2::uuid, $3::uuid, $4, $5, $6::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         encrypted_session_key = EXCLUDED.encrypted_session_key,
         encrypted_name = EXCLUDED.encrypted_name`,
      [inboxFolderId, userId, organizationId, encryptedInboxName.encryptedSessionKey, encryptedInboxName.encryptedName, nowIso]
    );
  } else {
    await client.query(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_session_key, encrypted_name, created_at)
       VALUES ($1::uuid, 'emailFolder', $2::uuid, $3, $4, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         encrypted_session_key = EXCLUDED.encrypted_session_key,
         encrypted_name = EXCLUDED.encrypted_name`,
      [inboxFolderId, userId, encryptedInboxName.encryptedSessionKey, encryptedInboxName.encryptedName, nowIso]
    );
  }

  if (hasOrganizationIdColumn) {
    await client.query(
      `INSERT INTO vfs_registry (id, object_type, owner_id, organization_id, encrypted_session_key, created_at)
       VALUES ($1::uuid, 'email', $2::uuid, $3::uuid, 'scaffolding-email-session-key', $4::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [emailItemId, userId, organizationId, nowIso]
    );
  } else {
    await client.query(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_session_key, created_at)
       VALUES ($1::uuid, 'email', $2::uuid, 'scaffolding-email-session-key', $3::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [emailItemId, userId, nowIso]
    );
  }

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
     VALUES ($1::uuid, $2, $3, $4::json, $5::json, $6, $7, $8::timestamptz, false, false)
     ON CONFLICT (id) DO NOTHING`,
    [
      emailItemId,
      encodeBase64(WELCOME_SUBJECT),
      encodeBase64(WELCOME_FROM),
      JSON.stringify([encodeBase64(userEmail)]),
      JSON.stringify([]),
      encryptedBodyPath,
      ciphertextSize,
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
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz)
     ON CONFLICT (parent_id, child_id) DO NOTHING`,
    [randomUUID(), inboxFolderId, emailItemId, 'scaffolding-link-wrap', nowIso]
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
       $1::uuid, $2::uuid, 'user', $3::uuid, 'read', $4,
       NULL, NULL, NULL,
       $5::timestamptz, $5::timestamptz, NULL, NULL
     )
     ON CONFLICT (item_id, principal_type, principal_id) DO UPDATE SET
       access_level = EXCLUDED.access_level,
       wrapped_session_key = EXCLUDED.wrapped_session_key,
       updated_at = EXCLUDED.updated_at`,
    [
      randomUUID(),
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
  const encryptVfsName = input.encryptVfsName ?? defaultEncryptVfsName;
  const nowIso = now().toISOString();

  await input.client.query('BEGIN');
  try {
    const hasOrganizationIdColumn =
      input.hasOrganizationIdColumn ??
      (await hasVfsRegistryOrganizationId(input.client));
    const bobRows = await input.client.query(
      `SELECT id, personal_organization_id FROM users WHERE email = $1 LIMIT 1`,
      [input.bobEmail]
    );
    const aliceRows = await input.client.query(
      `SELECT id, personal_organization_id FROM users WHERE email = $1 LIMIT 1`,
      [input.aliceEmail]
    );
    const bobIdentity = readRequiredUserId(bobRows.rows, input.bobEmail);
    const aliceIdentity = readRequiredUserId(aliceRows.rows, input.aliceEmail);
    const bobUserId = bobIdentity.userId;
    const aliceUserId = aliceIdentity.userId;

    const bobInboxId = idFactory();
    const bobEmailItemId = idFactory();
    await insertEmailForUser(
      input.client,
      bobUserId,
      bobIdentity.organizationId,
      input.bobEmail,
      bobInboxId,
      bobEmailItemId,
      nowIso,
      hasOrganizationIdColumn,
      encryptVfsName
    );

    const aliceInboxId = idFactory();
    const aliceEmailItemId = idFactory();
    await insertEmailForUser(
      input.client,
      aliceUserId,
      aliceIdentity.organizationId,
      input.aliceEmail,
      aliceInboxId,
      aliceEmailItemId,
      nowIso,
      hasOrganizationIdColumn,
      encryptVfsName
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
