import { randomUUID } from 'node:crypto';
import {
  type EncryptScaffoldVfsNameResult,
  encryptScaffoldVfsName
} from './encryptScaffoldVfsName.js';
import { hasVfsRegistryOrganizationId } from './vfsRegistrySchema.js';

type ShareAccessLevel = 'read' | 'write' | 'admin';

export interface DbQueryClient {
  query(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
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
  encryptVfsName?: (input: {
    client: DbQueryClient;
    ownerUserId: string;
    plaintextName: string;
  }) => Promise<EncryptScaffoldVfsNameResult>;
  hasOrganizationIdColumn?: boolean;
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
  noteShareAclId: string;
}

const DEFAULT_ROOT_ITEM_ID = '__vfs_root__';
const DEFAULT_FOLDER_NAME = 'Notes shared with Alice';
const DEFAULT_NOTE_NAME = 'Note for Alice - From Bob';
const DEFAULT_NOTE_PLAINTEXT = 'Hello, Alice';
const DEFAULT_SHARE_ACCESS_LEVEL: ShareAccessLevel = 'read';

function defaultEncryptVfsName(input: {
  client: DbQueryClient;
  ownerUserId: string;
  plaintextName: string;
}): Promise<EncryptScaffoldVfsNameResult> {
  return encryptScaffoldVfsName({
    ...input,
    allowOwnerWrappedSessionKey: false
  });
}

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function readRequiredUserId(
  rows: Array<{ id?: unknown; personal_organization_id?: unknown }>,
  email: string
): { userId: string; organizationId: string } {
  const userId = rows[0]?.id;
  const organizationId = rows[0]?.personal_organization_id;
  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    typeof organizationId !== 'string' ||
    organizationId.length === 0
  ) {
    throw new Error(`Could not resolve user id for ${email}`);
  }
  return {
    userId,
    organizationId
  };
}

function readRequiredAclId(rows: Array<{ id?: unknown }>): string {
  const aclId = rows[0]?.id;
  if (typeof aclId !== 'string' || aclId.length === 0) {
    throw new Error('Failed to create or update share ACL row');
  }
  return aclId;
}

interface InsertVfsRootInput {
  client: DbQueryClient;
  rootItemId: string;
  organizationId: string;
  hasOrganizationIdColumn: boolean;
  nowIso: string;
}

async function insertVfsRoot(input: InsertVfsRootInput): Promise<void> {
  const columns = ['id', 'object_type', 'owner_id'];
  const params: unknown[] = [input.rootItemId, 'folder', null];

  if (input.hasOrganizationIdColumn) {
    columns.push('organization_id');
    params.push(input.organizationId);
  }

  columns.push('encrypted_session_key', 'encrypted_name', 'created_at');
  params.push(null, 'VFS Root', input.nowIso);

  const placeholders = params
    .map((_value, index) => `$${index + 1}`)
    .join(', ');
  await input.client.query(
    `INSERT INTO vfs_registry (${columns.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (id) DO NOTHING`,
    params
  );
}

interface UpsertVfsRegistryItemInput {
  client: DbQueryClient;
  itemId: string;
  objectType: 'folder' | 'note';
  ownerId: string;
  organizationId: string;
  hasOrganizationIdColumn: boolean;
  encryptedSessionKey: string;
  encryptedName: string;
  nowIso: string;
}

async function upsertVfsRegistryItem(
  input: UpsertVfsRegistryItemInput
): Promise<void> {
  const columns = ['id', 'object_type', 'owner_id'];
  const params: unknown[] = [input.itemId, input.objectType, input.ownerId];
  const updateAssignments = [
    'object_type = EXCLUDED.object_type',
    'owner_id = EXCLUDED.owner_id'
  ];

  if (input.hasOrganizationIdColumn) {
    columns.push('organization_id');
    params.push(input.organizationId);
    updateAssignments.push('organization_id = EXCLUDED.organization_id');
  }

  columns.push('encrypted_session_key', 'encrypted_name', 'created_at');
  params.push(input.encryptedSessionKey, input.encryptedName, input.nowIso);
  updateAssignments.push(
    'encrypted_session_key = EXCLUDED.encrypted_session_key',
    'encrypted_name = EXCLUDED.encrypted_name'
  );

  const placeholders = params
    .map((_value, index) => `$${index + 1}`)
    .join(', ');
  await input.client.query(
    `INSERT INTO vfs_registry (${columns.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET
       ${updateAssignments.join(', ')}`,
    params
  );
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
  const shareAccessLevel = input.shareAccessLevel ?? DEFAULT_SHARE_ACCESS_LEVEL;
  const encryptVfsName = input.encryptVfsName ?? defaultEncryptVfsName;
  const nowDate = now();
  const nowIso = nowDate.toISOString();
  // Guardrail: keep scaffolded item_upsert clearly ordered before trigger-emitted
  // link/ACL ops even when consumers compare occurred_at at millisecond precision.
  const noteItemUpsertOccurredAtIso = new Date(
    nowDate.getTime() - 1000
  ).toISOString();

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
    const encryptedFolder = await encryptVfsName({
      client: input.client,
      ownerUserId: bobUserId,
      plaintextName: folderName
    });
    const encryptedNote = await encryptVfsName({
      client: input.client,
      ownerUserId: bobUserId,
      plaintextName: noteName
    });

    await insertVfsRoot({
      client: input.client,
      rootItemId,
      organizationId: bobIdentity.organizationId,
      hasOrganizationIdColumn,
      nowIso
    });

    await upsertVfsRegistryItem({
      client: input.client,
      itemId: folderId,
      objectType: 'folder',
      ownerId: bobUserId,
      organizationId: bobIdentity.organizationId,
      hasOrganizationIdColumn,
      encryptedSessionKey: encryptedFolder.encryptedSessionKey,
      encryptedName: encryptedFolder.encryptedName,
      nowIso
    });

    await upsertVfsRegistryItem({
      client: input.client,
      itemId: noteId,
      objectType: 'note',
      ownerId: bobUserId,
      organizationId: bobIdentity.organizationId,
      hasOrganizationIdColumn,
      encryptedSessionKey: encryptedNote.encryptedSessionKey,
      encryptedName: encryptedNote.encryptedName,
      nowIso
    });

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
      `INSERT INTO vfs_crdt_ops (
         id,
         item_id,
         op_type,
         actor_id,
         source_table,
         source_id,
         occurred_at,
         encrypted_payload,
         key_epoch,
         encryption_nonce,
         encryption_aad,
         encryption_signature
       )
       VALUES (
         $1,
         $2,
         'item_upsert',
         $3,
         'vfs_item_state',
         $4,
         $5::timestamptz,
         $6,
         1,
         $7,
         $8,
         $9
       )
       ON CONFLICT (id) DO UPDATE SET
         item_id = EXCLUDED.item_id,
         op_type = EXCLUDED.op_type,
         actor_id = EXCLUDED.actor_id,
         source_table = EXCLUDED.source_table,
         source_id = EXCLUDED.source_id,
         occurred_at = EXCLUDED.occurred_at,
         encrypted_payload = EXCLUDED.encrypted_payload,
         key_epoch = EXCLUDED.key_epoch,
         encryption_nonce = EXCLUDED.encryption_nonce,
         encryption_aad = EXCLUDED.encryption_aad,
         encryption_signature = EXCLUDED.encryption_signature`,
      [
        `crdt:item_upsert:${noteId}`,
        noteId,
        bobUserId,
        `vfs_item_state:${noteId}`,
        noteItemUpsertOccurredAtIso,
        encodeBase64(notePlaintext),
        encodeBase64(`nonce-${idFactory()}`),
        encodeBase64(`aad-${idFactory()}`),
        encodeBase64(`sig-${idFactory()}`)
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
    const shareRows = await input.client.query(
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
    const noteShareId = `share:${idFactory()}`;
    const noteShareRows = await input.client.query(
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
        noteShareId,
        noteId,
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
      shareAclId: readRequiredAclId(shareRows.rows),
      noteShareAclId: readRequiredAclId(noteShareRows.rows)
    };
  } catch (error) {
    await input.client.query('ROLLBACK');
    throw error;
  }
}
