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

export interface SetupBobPlaylistShareForAliceDbInput {
  client: DbQueryClient;
  bobEmail: string;
  aliceEmail: string;
  rootItemId?: string;
  playlistId?: string;
  audioId?: string;
  playlistName?: string;
  audioName?: string;
  audioContentBase64?: string;
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

export interface SetupBobPlaylistShareForAliceDbResult {
  bobUserId: string;
  aliceUserId: string;
  rootItemId: string;
  playlistId: string;
  audioId: string;
  playlistShareAclId: string;
  audioShareAclId: string;
}

const DEFAULT_ROOT_ITEM_ID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_PLAYLIST_NAME = 'Music shared with Alice';
const DEFAULT_AUDIO_NAME = 'The Blessing.mp3';
const DEFAULT_SHARE_ACCESS_LEVEL: ShareAccessLevel = 'read';

// Minimal valid WAV (88 bytes): RIFF header + fmt (PCM mono 8kHz 8-bit) + 44 silence samples
export const SCAFFOLD_SYNTHETIC_WAV_BASE64 = Buffer.from(
  'RIFF' +
    'X\x00\x00\x00' +
    'WAVE' +
    'fmt ' +
    '\x10\x00\x00\x00' +
    '\x01\x00' +
    '\x01\x00' +
    '\x40\x1f\x00\x00' +
    '\x40\x1f\x00\x00' +
    '\x01\x00' +
    '\x08\x00' +
    'data' +
    ',\x00\x00\x00' +
    '\x80'.repeat(44),
  'binary'
).toString('base64');

export async function setupBobPlaylistShareForAliceDb(
  input: SetupBobPlaylistShareForAliceDbInput
): Promise<SetupBobPlaylistShareForAliceDbResult> {
  const idFactory = input.idFactory ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const rootItemId = input.rootItemId ?? DEFAULT_ROOT_ITEM_ID;
  const playlistId = input.playlistId ?? idFactory();
  const audioId = input.audioId ?? idFactory();
  const playlistName = input.playlistName ?? DEFAULT_PLAYLIST_NAME;
  const audioName = input.audioName ?? DEFAULT_AUDIO_NAME;
  const audioContentBase64 =
    input.audioContentBase64 ?? SCAFFOLD_SYNTHETIC_WAV_BASE64;
  const shareAccessLevel = input.shareAccessLevel ?? DEFAULT_SHARE_ACCESS_LEVEL;
  const encryptVfsName = input.encryptVfsName ?? defaultEncryptVfsName;
  const nowDate = now();
  const nowIso = nowDate.toISOString();
  const audioItemUpsertOccurredAtIso = new Date(
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
    const encryptedPlaylist = await encryptVfsName({
      client: input.client,
      ownerUserId: bobUserId,
      plaintextName: playlistName
    });
    const encryptedAudio = await encryptVfsName({
      client: input.client,
      ownerUserId: bobUserId,
      plaintextName: audioName
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
      itemId: playlistId,
      objectType: 'playlist',
      ownerId: bobUserId,
      organizationId: bobIdentity.organizationId,
      hasOrganizationIdColumn,
      encryptedSessionKey: encryptedPlaylist.encryptedSessionKey,
      encryptedName: encryptedPlaylist.encryptedName,
      nowIso
    });

    await upsertVfsRegistryItem({
      client: input.client,
      itemId: audioId,
      objectType: 'audio',
      ownerId: bobUserId,
      organizationId: bobIdentity.organizationId,
      hasOrganizationIdColumn,
      encryptedSessionKey: encryptedAudio.encryptedSessionKey,
      encryptedName: encryptedAudio.encryptedName,
      nowIso
    });

    await input.client.query(
      `INSERT INTO playlists (id, encrypted_name, shuffle_mode)
       VALUES ($1::uuid, $2, 0)
       ON CONFLICT (id) DO UPDATE SET
         encrypted_name = EXCLUDED.encrypted_name,
         shuffle_mode = EXCLUDED.shuffle_mode`,
      [playlistId, encryptedPlaylist.encryptedName]
    );

    const audioNonce = encodeBase64(idFactory());
    const audioAad = encodeBase64(idFactory());
    const audioSignature = encodeBase64(idFactory());

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
      [
        audioId,
        audioContentBase64,
        audioNonce,
        audioAad,
        audioSignature,
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
        audioId,
        bobUserId,
        `vfs-item-state:${audioId}`,
        audioItemUpsertOccurredAtIso,
        audioContentBase64,
        audioNonce,
        audioAad,
        audioSignature,
        playlistId
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
      [randomUUID(), rootItemId, playlistId, 'scaffolding-link-wrap', nowIso]
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
      [randomUUID(), playlistId, audioId, 'scaffolding-link-wrap', nowIso]
    );

    const playlistShareId = idFactory();
    const playlistShareRows = await input.client.query(
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
        playlistShareId,
        playlistId,
        aliceUserId,
        shareAccessLevel,
        'scaffolding-share-wrap',
        bobUserId,
        nowIso
      ]
    );

    const audioShareId = idFactory();
    const audioShareRows = await input.client.query(
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
        audioShareId,
        audioId,
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
      playlistId,
      audioId,
      playlistShareAclId: readRequiredAclId(playlistShareRows.rows),
      audioShareAclId: readRequiredAclId(audioShareRows.rows)
    };
  } catch (error) {
    await input.client.query('ROLLBACK');
    throw error;
  }
}
