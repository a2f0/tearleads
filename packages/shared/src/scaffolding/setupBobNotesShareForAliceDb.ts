import { randomUUID } from 'node:crypto';
import type { EncryptScaffoldVfsNameResult } from './encryptScaffoldVfsName.js';
import { hasVfsRegistryOrganizationId } from './vfsRegistrySchema.js';
import {
  type DbQueryClient,
  defaultEncryptVfsName,
  encodeBase64,
  insertVfsRoot,
  readRequiredAclId,
  readRequiredUserId,
  type ShareAccessLevel,
  upsertVfsRegistryItem
} from './vfsScaffoldHelpers.js';

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

const DEFAULT_ROOT_ITEM_ID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_FOLDER_NAME = 'Notes shared with Alice';
const DEFAULT_NOTE_NAME = 'Note for Alice - From Bob';
const DEFAULT_NOTE_PLAINTEXT = 'Hello, Alice';
const DEFAULT_SHARE_ACCESS_LEVEL: ShareAccessLevel = 'write';

export async function setupBobNotesShareForAliceDb(
  input: SetupBobNotesShareForAliceDbInput
): Promise<SetupBobNotesShareForAliceDbResult> {
  const idFactory = input.idFactory ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const rootItemId = input.rootItemId ?? DEFAULT_ROOT_ITEM_ID;
  const folderId = input.folderId ?? idFactory();
  const noteId = input.noteId ?? idFactory();
  const folderName = input.folderName ?? DEFAULT_FOLDER_NAME;
  const noteName = input.noteName ?? DEFAULT_NOTE_NAME;
  const notePlaintext = input.notePlaintext ?? DEFAULT_NOTE_PLAINTEXT;
  const shareAccessLevel = input.shareAccessLevel ?? DEFAULT_SHARE_ACCESS_LEVEL;
  const encryptVfsName = input.encryptVfsName ?? defaultEncryptVfsName;
  const nowDate = now();
  const nowIso = nowDate.toISOString();
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

    const notePayload = encodeBase64(notePlaintext);
    const noteNonce = encodeBase64(idFactory());
    const noteAad = encodeBase64(idFactory());
    const noteSignature = encodeBase64(idFactory());

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
       VALUES ($1::uuid, $2, 1, $3, $4, $5, $6::timestamptz, NULL)
       ON CONFLICT (item_id) DO UPDATE SET
         encrypted_payload = EXCLUDED.encrypted_payload,
         key_epoch = EXCLUDED.key_epoch,
         encryption_nonce = EXCLUDED.encryption_nonce,
         encryption_aad = EXCLUDED.encryption_aad,
         encryption_signature = EXCLUDED.encryption_signature,
         updated_at = EXCLUDED.updated_at,
         deleted_at = NULL`,
      [noteId, notePayload, noteNonce, noteAad, noteSignature, nowIso]
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
         encryption_signature,
         encrypted_payload_bytes,
         encryption_nonce_bytes,
         encryption_aad_bytes,
         encryption_signature_bytes,
         root_id
       )
       VALUES (
         $1::uuid,
         $2::uuid,
         'item_upsert',
         $3::uuid,
         'vfs_item_state',
         $4,
         $5::timestamptz,
         NULL,
         1,
         NULL,
         NULL,
         NULL,
         decode($6::text, 'base64'),
         decode($7::text, 'base64'),
         decode($8::text, 'base64'),
         decode($9::text, 'base64'),
         $10::uuid
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
         encryption_signature = EXCLUDED.encryption_signature,
         encrypted_payload_bytes = EXCLUDED.encrypted_payload_bytes,
         encryption_nonce_bytes = EXCLUDED.encryption_nonce_bytes,
         encryption_aad_bytes = EXCLUDED.encryption_aad_bytes,
         encryption_signature_bytes = EXCLUDED.encryption_signature_bytes,
         root_id = EXCLUDED.root_id`,
      [
        idFactory(),
        noteId,
        bobUserId,
        `vfs-item-state:${noteId}`,
        noteItemUpsertOccurredAtIso,
        notePayload,
        noteNonce,
        noteAad,
        noteSignature,
        folderId
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
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz)
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
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz)
       ON CONFLICT (parent_id, child_id) DO NOTHING`,
      [randomUUID(), folderId, noteId, 'scaffolding-link-wrap', nowIso]
    );

    const shareId = idFactory();
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
         $1::uuid,
         $2::uuid,
         'user',
         $3::uuid,
         $4,
         $5,
         1,
         $6::uuid,
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
    const noteShareId = idFactory();
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
         $1::uuid,
         $2::uuid,
         'user',
         $3::uuid,
         $4,
         $5,
         1,
         $6::uuid,
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
