import {
  type EncryptScaffoldVfsNameResult,
  encryptScaffoldVfsName
} from './encryptScaffoldVfsName.js';

export type ShareAccessLevel = 'read' | 'write' | 'admin';

export interface DbQueryClient {
  query(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export function defaultEncryptVfsName(input: {
  client: DbQueryClient;
  ownerUserId: string;
  plaintextName: string;
}): Promise<EncryptScaffoldVfsNameResult> {
  return encryptScaffoldVfsName({
    ...input,
    allowOwnerWrappedSessionKey: false
  });
}

export function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function readRequiredUserId(
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
  return { userId, organizationId };
}

export function readRequiredAclId(rows: Array<{ id?: unknown }>): string {
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

export async function insertVfsRoot(input: InsertVfsRootInput): Promise<void> {
  if (input.hasOrganizationIdColumn) {
    await input.client.query(
      `INSERT INTO vfs_registry (id, object_type, owner_id, organization_id, encrypted_session_key, encrypted_name, created_at)
       VALUES ($1::uuid, 'folder', NULL, $2::uuid, NULL, 'VFS Root', $3::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [input.rootItemId, input.organizationId, input.nowIso]
    );
  } else {
    await input.client.query(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_session_key, encrypted_name, created_at)
       VALUES ($1::uuid, 'folder', NULL, NULL, 'VFS Root', $2::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [input.rootItemId, input.nowIso]
    );
  }
}

interface UpsertVfsRegistryItemInput {
  client: DbQueryClient;
  itemId: string;
  objectType: string;
  ownerId: string;
  organizationId: string;
  hasOrganizationIdColumn: boolean;
  encryptedSessionKey: string;
  encryptedName: string;
  nowIso: string;
}

export async function upsertVfsRegistryItem(
  input: UpsertVfsRegistryItemInput
): Promise<void> {
  if (input.hasOrganizationIdColumn) {
    await input.client.query(
      `INSERT INTO vfs_registry (id, object_type, owner_id, organization_id, encrypted_session_key, encrypted_name, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         object_type = EXCLUDED.object_type,
         owner_id = EXCLUDED.owner_id,
         organization_id = EXCLUDED.organization_id,
         encrypted_session_key = EXCLUDED.encrypted_session_key,
         encrypted_name = EXCLUDED.encrypted_name`,
      [
        input.itemId,
        input.objectType,
        input.ownerId,
        input.organizationId,
        input.encryptedSessionKey,
        input.encryptedName,
        input.nowIso
      ]
    );
  } else {
    await input.client.query(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_session_key, encrypted_name, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         object_type = EXCLUDED.object_type,
         owner_id = EXCLUDED.owner_id,
         encrypted_session_key = EXCLUDED.encrypted_session_key,
         encrypted_name = EXCLUDED.encrypted_name`,
      [
        input.itemId,
        input.objectType,
        input.ownerId,
        input.encryptedSessionKey,
        input.encryptedName,
        input.nowIso
      ]
    );
  }
}
