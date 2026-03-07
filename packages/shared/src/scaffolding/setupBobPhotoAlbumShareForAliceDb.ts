import { randomUUID } from 'node:crypto';
import {
  type EncryptScaffoldVfsNameResult,
  encryptScaffoldVfsName
} from './encryptScaffoldVfsName.js';
import type { DbQueryClient } from './setupBobNotesShareForAliceDb.js';
import { hasVfsRegistryOrganizationId } from './vfsRegistrySchema.js';

type ShareAccessLevel = 'read' | 'write' | 'admin';

export interface SetupBobPhotoAlbumShareForAliceDbInput {
  client: DbQueryClient;
  bobEmail: string;
  aliceEmail: string;
  rootItemId?: string;
  albumId?: string;
  photoId?: string;
  albumName?: string;
  photoName?: string;
  photoSvg?: string;
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

export interface SetupBobPhotoAlbumShareForAliceDbResult {
  bobUserId: string;
  aliceUserId: string;
  rootItemId: string;
  albumId: string;
  photoId: string;
  albumShareAclId: string;
  photoShareAclId: string;
}

const DEFAULT_ROOT_ITEM_ID = '__vfs_root__';
const DEFAULT_ALBUM_NAME = 'Photos shared with Alice';
const DEFAULT_PHOTO_NAME = 'Tearleads logo.svg';
const DEFAULT_SHARE_ACCESS_LEVEL: ShareAccessLevel = 'read';

export const SCAFFOLD_SHARED_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="33" height="33" viewBox="0 0 33 33">
  <!-- L (right vertical bar) -->
  <rect x="24" y="12" width="9" height="21" fill="#555"/>
  <!-- Bottom square (colon) -->
  <rect x="0" y="24" width="9" height="9" fill="#555"/>
  <!-- Top square (colon) -->
  <rect x="0" y="12" width="9" height="9" fill="#555"/>
  <!-- T (horizontal bar) -->
  <rect x="0" y="0" width="33" height="9" fill="#999"/>
  <!-- T (vertical bar) -->
  <rect x="12" y="0" width="9" height="33" fill="#999"/>
</svg>
`;

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
  objectType: 'album' | 'photo';
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

export async function setupBobPhotoAlbumShareForAliceDb(
  input: SetupBobPhotoAlbumShareForAliceDbInput
): Promise<SetupBobPhotoAlbumShareForAliceDbResult> {
  const idFactory = input.idFactory ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const rootItemId = input.rootItemId ?? DEFAULT_ROOT_ITEM_ID;
  const albumId = input.albumId ?? `album-${idFactory()}`;
  const photoId = input.photoId ?? `photo-${idFactory()}`;
  const albumName = input.albumName ?? DEFAULT_ALBUM_NAME;
  const photoName = input.photoName ?? DEFAULT_PHOTO_NAME;
  const photoSvg = input.photoSvg ?? SCAFFOLD_SHARED_LOGO_SVG;
  const shareAccessLevel = input.shareAccessLevel ?? DEFAULT_SHARE_ACCESS_LEVEL;
  const encryptVfsName = input.encryptVfsName ?? defaultEncryptVfsName;
  const nowDate = now();
  const nowIso = nowDate.toISOString();
  // Keep deterministic ordering for consumers that compare timestamps at
  // millisecond precision.
  const photoItemUpsertOccurredAtIso = new Date(
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
    const encryptedAlbum = await encryptVfsName({
      client: input.client,
      ownerUserId: bobUserId,
      plaintextName: albumName
    });
    const encryptedPhoto = await encryptVfsName({
      client: input.client,
      ownerUserId: bobUserId,
      plaintextName: photoName
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
      itemId: albumId,
      objectType: 'album',
      ownerId: bobUserId,
      organizationId: bobIdentity.organizationId,
      hasOrganizationIdColumn,
      encryptedSessionKey: encryptedAlbum.encryptedSessionKey,
      encryptedName: encryptedAlbum.encryptedName,
      nowIso
    });

    await upsertVfsRegistryItem({
      client: input.client,
      itemId: photoId,
      objectType: 'photo',
      ownerId: bobUserId,
      organizationId: bobIdentity.organizationId,
      hasOrganizationIdColumn,
      encryptedSessionKey: encryptedPhoto.encryptedSessionKey,
      encryptedName: encryptedPhoto.encryptedName,
      nowIso
    });

    const photoPayload = encodeBase64(photoSvg);
    const photoNonce = encodeBase64(`nonce-${idFactory()}`);
    const photoAad = encodeBase64(`aad-${idFactory()}`);
    const photoSignature = encodeBase64(`sig-${idFactory()}`);

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
      [photoId, photoPayload, photoNonce, photoAad, photoSignature, nowIso]
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
         encryption_signature, encrypted_payload_bytes, encryption_nonce_bytes,
         encryption_aad_bytes, encryption_signature_bytes
       )
       VALUES (
         $1,
         $2,
         'item_upsert',
         $3,
         'vfs_item_state',
         $4,
         $5::timestamptz,
         NULL,
         1,
         NULL,
         NULL,
         NULL,
         decode($6::text, 'base64'), decode($7::text, 'base64'),
         decode($8::text, 'base64'), decode($9::text, 'base64')
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
         encryption_signature_bytes = EXCLUDED.encryption_signature_bytes`,
      [
        `crdt:item_upsert:${photoId}`,
        photoId,
        bobUserId,
        `vfs_item_state:${photoId}`,
        photoItemUpsertOccurredAtIso,
        photoPayload,
        photoNonce,
        photoAad,
        photoSignature
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
      [idFactory(), rootItemId, albumId, 'scaffolding-link-wrap', nowIso]
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
      [idFactory(), albumId, photoId, 'scaffolding-link-wrap', nowIso]
    );

    const albumShareId = `share:${idFactory()}`;
    const albumShareRows = await input.client.query(
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
        albumShareId,
        albumId,
        aliceUserId,
        shareAccessLevel,
        'scaffolding-share-wrap',
        bobUserId,
        nowIso
      ]
    );

    const photoShareId = `share:${idFactory()}`;
    const photoShareRows = await input.client.query(
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
        photoShareId,
        photoId,
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
      albumId,
      photoId,
      albumShareAclId: readRequiredAclId(albumShareRows.rows),
      photoShareAclId: readRequiredAclId(photoShareRows.rows)
    };
  } catch (error) {
    await input.client.query('ROLLBACK');
    throw error;
  }
}
