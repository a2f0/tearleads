import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  UpdateVfsShareRequest,
  VfsPermissionLevel,
  VfsShareType
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import type { Pool } from 'pg';

const VALID_SHARE_TYPES: VfsShareType[] = ['user', 'group', 'organization'];
const VALID_PERMISSION_LEVELS: VfsPermissionLevel[] = [
  'view',
  'edit',
  'download'
];

export type VfsAclAccessLevel = 'read' | 'write' | 'admin';
type QueryExecutor = Pick<Pool, 'query'>;

const SHARE_ID_PREFIX = 'share:';
const ORG_SHARE_ID_PREFIX = 'org-share:';

export interface ShareAuthorizationContext {
  ownerId: string | null;
  itemId: string;
  shareType: VfsShareType;
  targetId: string;
  accessLevel: VfsAclAccessLevel;
  aclId: string;
}

export interface OrgShareAuthorizationContext {
  ownerId: string | null;
  itemId: string;
  targetOrgId: string;
  accessLevel: VfsAclAccessLevel;
  aclId: string;
  sourceOrgId: string | null;
}

export function mapSharePermissionLevelToAclAccessLevel(
  permissionLevel: VfsPermissionLevel
): VfsAclAccessLevel {
  if (permissionLevel === 'edit') {
    return 'write';
  }

  /**
   * Guardrail: share-level `download` has no direct ACL equivalent.
   * We fail closed by mapping it to `read` (never implicit write/admin).
   */
  return 'read';
}

export function mapAclAccessLevelToSharePermissionLevel(
  accessLevel: VfsAclAccessLevel
): VfsPermissionLevel {
  if (accessLevel === 'read') {
    return 'view';
  }

  /**
   * Guardrail: VFS share API does not expose `admin`; it is collapsed to
   * `edit` to avoid over-promising permissions unsupported by clients.
   */
  return 'edit';
}

function parseAclAccessLevel(value: unknown): VfsAclAccessLevel {
  if (value === 'read' || value === 'write' || value === 'admin') {
    return value;
  }

  throw new Error(
    'Unsupported ACL access level in share authorization context'
  );
}

function parseOrgShareAclId(aclId: string): {
  shareId: string;
  sourceOrgId: string | null;
} {
  if (!aclId.startsWith(ORG_SHARE_ID_PREFIX)) {
    throw new Error('Unsupported ACL id in org-share authorization context');
  }

  const suffix = aclId.slice(ORG_SHARE_ID_PREFIX.length);
  const separatorIndex = suffix.indexOf(':');
  if (separatorIndex === -1) {
    return {
      shareId: suffix,
      sourceOrgId: null
    };
  }

  const sourceOrgId = suffix.slice(0, separatorIndex);
  const shareId = suffix.slice(separatorIndex + 1);
  if (!shareId) {
    throw new Error('Unsupported ACL id in org-share authorization context');
  }

  return {
    shareId,
    sourceOrgId: sourceOrgId || null
  };
}

export function buildShareAclId(shareId: string): string {
  return `${SHARE_ID_PREFIX}${shareId}`;
}

export function buildLegacyOrgShareAclId(shareId: string): string {
  return `${ORG_SHARE_ID_PREFIX}${shareId}`;
}

export function buildOrgShareAclId(
  sourceOrgId: string,
  shareId: string
): string {
  return `${ORG_SHARE_ID_PREFIX}${sourceOrgId}:${shareId}`;
}

export function extractShareIdFromAclId(aclId: string): string {
  if (!aclId.startsWith(SHARE_ID_PREFIX)) {
    throw new Error('Unsupported ACL id in share response mapping');
  }

  return aclId.slice(SHARE_ID_PREFIX.length);
}

export function extractOrgShareIdFromAclId(aclId: string): string {
  return parseOrgShareAclId(aclId).shareId;
}

export function extractSourceOrgIdFromOrgShareAclId(
  aclId: string
): string | null {
  return parseOrgShareAclId(aclId).sourceOrgId;
}

export async function loadShareAuthorizationContext(
  queryExecutor: QueryExecutor,
  shareId: string
): Promise<ShareAuthorizationContext | null> {
  const canonicalResult = await queryExecutor.query<{
    owner_id: string | null;
    acl_id: string;
    item_id: string;
    principal_type: VfsShareType;
    principal_id: string;
    access_level: VfsAclAccessLevel;
  }>(
    `SELECT
        r.owner_id,
        acl.id AS acl_id,
        acl.item_id,
        acl.principal_type,
        acl.principal_id,
        acl.access_level
       FROM vfs_acl_entries acl
       JOIN vfs_registry r
         ON r.id = acl.item_id
      WHERE acl.id = $1
        AND acl.revoked_at IS NULL
      LIMIT 1`,
    [buildShareAclId(shareId)]
  );
  const canonicalRow = canonicalResult.rows[0];
  if (!canonicalRow) {
    return null;
  }

  if (!isValidShareType(canonicalRow.principal_type)) {
    throw new Error(
      'Unsupported ACL principal type in share authorization context'
    );
  }

  return {
    ownerId: canonicalRow.owner_id,
    aclId: canonicalRow.acl_id,
    itemId: canonicalRow.item_id,
    shareType: canonicalRow.principal_type,
    targetId: canonicalRow.principal_id,
    accessLevel: parseAclAccessLevel(canonicalRow.access_level)
  };
}

export async function loadOrgShareAuthorizationContext(
  queryExecutor: QueryExecutor,
  shareId: string
): Promise<OrgShareAuthorizationContext | null> {
  const legacyAclId = buildLegacyOrgShareAclId(shareId);
  const canonicalResult = await queryExecutor.query<{
    owner_id: string | null;
    acl_id: string;
    item_id: string;
    principal_id: string;
    access_level: VfsAclAccessLevel;
  }>(
    `SELECT
        r.owner_id,
        acl.id AS acl_id,
        acl.item_id,
        acl.principal_id,
        acl.access_level
       FROM vfs_acl_entries acl
       JOIN vfs_registry r
         ON r.id = acl.item_id
      WHERE acl.principal_type = 'organization'
        AND acl.revoked_at IS NULL
        AND (acl.id = $1 OR acl.id LIKE $2)
      ORDER BY CASE WHEN acl.id = $1 THEN 0 ELSE 1 END
      LIMIT 1`,
    [legacyAclId, `${ORG_SHARE_ID_PREFIX}%:${shareId}`]
  );
  const canonicalRow = canonicalResult.rows[0];
  if (!canonicalRow || typeof canonicalRow.principal_id !== 'string') {
    return null;
  }

  return {
    ownerId: canonicalRow.owner_id,
    aclId: canonicalRow.acl_id,
    itemId: canonicalRow.item_id,
    targetOrgId: canonicalRow.principal_id,
    accessLevel: parseAclAccessLevel(canonicalRow.access_level),
    sourceOrgId: extractSourceOrgIdFromOrgShareAclId(canonicalRow.acl_id)
  };
}

export function isValidShareType(value: unknown): value is VfsShareType {
  return (
    typeof value === 'string' &&
    VALID_SHARE_TYPES.some((shareType) => shareType === value)
  );
}

function isValidPermissionLevel(value: unknown): value is VfsPermissionLevel {
  return (
    typeof value === 'string' &&
    VALID_PERMISSION_LEVELS.some((permissionLevel) => permissionLevel === value)
  );
}

export function parseCreateSharePayload(
  body: unknown
): CreateVfsShareRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const { itemId, shareType, targetId, permissionLevel, expiresAt } = body;

  if (
    typeof itemId !== 'string' ||
    !isValidShareType(shareType) ||
    typeof targetId !== 'string' ||
    !isValidPermissionLevel(permissionLevel)
  ) {
    return null;
  }

  if (!itemId.trim() || !targetId.trim()) {
    return null;
  }

  return {
    itemId: itemId.trim(),
    shareType,
    targetId: targetId.trim(),
    permissionLevel,
    expiresAt:
      typeof expiresAt === 'string' && expiresAt.trim()
        ? expiresAt.trim()
        : null
  };
}

export function parseCreateOrgSharePayload(
  body: unknown
): CreateOrgShareRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const { itemId, sourceOrgId, targetOrgId, permissionLevel, expiresAt } = body;

  if (
    typeof itemId !== 'string' ||
    typeof sourceOrgId !== 'string' ||
    typeof targetOrgId !== 'string' ||
    !isValidPermissionLevel(permissionLevel)
  ) {
    return null;
  }

  if (!itemId.trim() || !sourceOrgId.trim() || !targetOrgId.trim()) {
    return null;
  }

  return {
    itemId: itemId.trim(),
    sourceOrgId: sourceOrgId.trim(),
    targetOrgId: targetOrgId.trim(),
    permissionLevel,
    expiresAt:
      typeof expiresAt === 'string' && expiresAt.trim()
        ? expiresAt.trim()
        : null
  };
}

export function parseUpdateSharePayload(
  body: unknown
): UpdateVfsShareRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const { permissionLevel, expiresAt } = body;

  const result: UpdateVfsShareRequest = {};

  if (permissionLevel !== undefined) {
    if (!isValidPermissionLevel(permissionLevel)) {
      return null;
    }
    result.permissionLevel = permissionLevel;
  }

  if (expiresAt !== undefined) {
    if (expiresAt !== null && typeof expiresAt !== 'string') {
      return null;
    }
    result.expiresAt = expiresAt;
  }

  return result;
}
