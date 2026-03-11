import {
  type EncryptScaffoldVfsNameResult,
  encryptScaffoldVfsName
} from './encryptScaffoldVfsName.js';
import type { DbQueryClient } from './setupBobNotesShareForAliceDb.js';

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
