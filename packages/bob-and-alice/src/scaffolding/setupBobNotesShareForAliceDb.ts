import { randomUUID } from 'node:crypto';

type ShareAccessLevel = 'read' | 'write' | 'admin';

interface QueryResultRow {
  [key: string]: unknown;
}

interface QueryResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
}

export interface DbQueryClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<T>>;
}

export interface SetupBobNotesShareForAliceDbInput {
  client: DbQueryClient;
  bobEmail: string;
  aliceEmail: string;
  rootItemId?: string;
  folderId?: string;
  noteId?: string;
  folderName?: string;
  noteName?: string;
  notePlaintext?: string;
  shareAccessLevel?: ShareAccessLevel;
  idFactory?: () => string;
  now?: () => Date;
}

export interface SetupBobNotesShareForAliceDbResult {
  bobUserId: string;
  aliceUserId: string;
  rootItemId: string;
  folderId: string;
  noteId: string;
  shareAclId: string;
}

const DEFAULT_ROOT_ITEM_ID = '__vfs_root__';
const DEFAULT_FOLDER_NAME = 'Notes shared with Alice';
const DEFAULT_NOTE_NAME = 'Shared note for Alice';
const DEFAULT_NOTE_PLAINTEXT = "Note shared from Bob's VFS";
const DEFAULT_SHARE_ACCESS_LEVEL: ShareAccessLevel = 'read';

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

function readRequiredAclId(rows: Array<{ id?: unknown }>): string {
  const aclId = rows[0]?.id;
  if (typeof aclId !== 'string' || aclId.length === 0) {
    throw new Error('Failed to create or update share ACL row');
  }
  return aclId;
}

export async function setupBobNotesShareForAliceDb(
  input: SetupBobNotesShareForAliceDbInput
): Promise<SetupBobNotesShareForAliceDbResult> {
  const idFactory = input.idFactory ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const rootItemId = input.rootItemId ?? DEFAULT_ROOT_ITEM_ID;
  const folderId = input.folderId ?? `folder-${idFactory()}`;
  const noteId = input.noteId ?? `note-${idFactory()}`;
  const folderName = input.folderName ?? DEFAULT_FOLDER_NAME;
  const noteName = input.noteName ?? DEFAULT_NOTE_NAME;
  const notePlaintext = input.notePlaintext ?? DEFAULT_NOTE_PLAINTEXT;
  const shareAccessLevel =
    input.shareAccessLevel ?? DEFAULT_SHARE_ACCESS_LEVEL;
  const nowIso = now().toISOString();

  await input.client.query('BEGIN');
  try {
    const bobRows = await input.client.query<{ id: unknown }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [input.bobEmail]
    );
    const aliceRows = await input.client.query<{ id: unknown }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [input.aliceEmail]
    );
    const bobUserId = readRequiredUserId(bobRows.rows, input.bobEmail);
    const aliceUserId = readRequiredUserId(aliceRows.rows, input.aliceEmail);

    await input.client.query(
      `INSERT INTO vfs_registry (
         id,
         object_type,
         owner_id,
         encrypted_session_key,
         encrypted_name,
         created_at
       )
       VALUES ($1, 'folder', NULL, NULL, 'VFS Root', $2::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [rootItemId, nowIso]
    );

    await input.client.query(
      `INSERT INTO vfs_registry (
         id,
         object_type,
         owner_id,
         encrypted_session_key,
         encrypted_name,
         created_at
       )
       VALUES ($1, 'folder', $2, $3, $4, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         object_type = EXCLUDED.object_type,
         owner_id = EXCLUDED.owner_id,
         encrypted_session_key = EXCLUDED.encrypted_session_key,
         encrypted_name = EXCLUDED.encrypted_name`,
      [folderId, bobUserId, 'bob-folder-session-key', folderName, nowIso]
    );

    await input.client.query(
      `INSERT INTO vfs_registry (
         id,
         object_type,
         owner_id,
         encrypted_session_key,
         encrypted_name,
         created_at
       )
       VALUES ($1, 'note', $2, $3, $4, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         object_type = EXCLUDED.object_type,
         owner_id = EXCLUDED.owner_id,
         encrypted_session_key = EXCLUDED.encrypted_session_key,
         encrypted_name = EXCLUDED.encrypted_name`,
      [noteId, bobUserId, 'bob-note-session-key', noteName, nowIso]
    );

    await input.client.query(
      `INSERT INTO vfs_item_state (
         item_id,
         encrypted_payload,
         key_epoch,
         encryption_nonce,
         encryption_aad,
         encryption_signature,
         updated_at,
         deleted_at
       )
       VALUES ($1, $2, 1, $3, $4, $5, $6::timestamptz, NULL)
       ON CONFLICT (item_id) DO UPDATE SET
         encrypted_payload = EXCLUDED.encrypted_payload,
         key_epoch = EXCLUDED.key_epoch,
         encryption_nonce = EXCLUDED.encryption_nonce,
         encryption_aad = EXCLUDED.encryption_aad,
         encryption_signature = EXCLUDED.encryption_signature,
         updated_at = EXCLUDED.updated_at,
         deleted_at = NULL`,
      [
        noteId,
        encodeBase64(notePlaintext),
        encodeBase64(`nonce-${idFactory()}`),
        encodeBase64(`aad-${idFactory()}`),
        encodeBase64(`sig-${idFactory()}`),
        nowIso
      ]
    );

    await input.client.query(
      `INSERT INTO vfs_links (
         id,
         parent_id,
         child_id,
         wrapped_session_key,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (parent_id, child_id) DO NOTHING`,
      [randomUUID(), rootItemId, folderId, 'scaffolding-link-wrap', nowIso]
    );

    await input.client.query(
      `INSERT INTO vfs_links (
         id,
         parent_id,
         child_id,
         wrapped_session_key,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (parent_id, child_id) DO NOTHING`,
      [randomUUID(), folderId, noteId, 'scaffolding-link-wrap', nowIso]
    );

    const shareId = `share:${idFactory()}`;
    const shareRows = await input.client.query<{ id: unknown }>(
      `INSERT INTO vfs_acl_entries (
         id,
         item_id,
         principal_type,
         principal_id,
         access_level,
         wrapped_session_key,
         key_epoch,
         granted_by,
         created_at,
         updated_at,
         expires_at,
         revoked_at
       )
       VALUES (
         $1,
         $2,
         'user',
         $3,
         $4,
         $5,
         1,
         $6,
         $7::timestamptz,
         $7::timestamptz,
         NULL,
         NULL
       )
       ON CONFLICT (item_id, principal_type, principal_id) DO UPDATE SET
         access_level = EXCLUDED.access_level,
         wrapped_session_key = EXCLUDED.wrapped_session_key,
         key_epoch = EXCLUDED.key_epoch,
         granted_by = EXCLUDED.granted_by,
         updated_at = EXCLUDED.updated_at,
         expires_at = NULL,
         revoked_at = NULL
       RETURNING id`,
      [
        shareId,
        folderId,
        aliceUserId,
        shareAccessLevel,
        'scaffolding-share-wrap',
        bobUserId,
        nowIso
      ]
    );

    await input.client.query('COMMIT');

    return {
      bobUserId,
      aliceUserId,
      rootItemId,
      folderId,
      noteId,
      shareAclId: readRequiredAclId(shareRows.rows)
    };
  } catch (error) {
    await input.client.query('ROLLBACK');
    throw error;
  }
}
