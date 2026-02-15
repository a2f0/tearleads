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

export interface ShareAuthorizationContext {
  ownerId: string | null;
  itemId: string;
  shareType: VfsShareType;
  targetId: string;
  accessLevel: VfsAclAccessLevel;
  source: 'canonical' | 'legacy';
}

export interface OrgShareAuthorizationContext {
  ownerId: string | null;
  itemId: string;
  targetOrgId: string;
  accessLevel: VfsAclAccessLevel;
  source: 'canonical' | 'legacy';
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

function parseAclAccessLevel(value: unknown): VfsAclAccessLevel {
  if (value === 'read' || value === 'write' || value === 'admin') {
    return value;
  }

  throw new Error(
    'Unsupported ACL access level in share authorization context'
  );
}

function parseCount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Guardrail: while legacy share-read routes remain active, they must never
 * serve rows that are missing canonical active ACL parity.
 */
export async function assertItemShareReadParity(
  queryExecutor: QueryExecutor,
  itemId: string
): Promise<void> {
  const missingShareParityResult = await queryExecutor.query<{
    missing_count: number | string;
  }>(
    `SELECT COUNT(*)::BIGINT AS missing_count
       FROM vfs_shares s
       LEFT JOIN vfs_acl_entries acl
         ON acl.item_id = s.item_id
        AND acl.principal_type = s.share_type
        AND acl.principal_id = s.target_id
        AND acl.revoked_at IS NULL
        AND acl.access_level = CASE s.permission_level
          WHEN 'edit' THEN 'write'
          ELSE 'read'
        END
        AND acl.granted_by IS NOT DISTINCT FROM s.created_by
        AND acl.expires_at IS NOT DISTINCT FROM s.expires_at
      WHERE s.item_id = $1
        AND acl.id IS NULL`,
    [itemId]
  );
  const missingShareParityCount = parseCount(
    missingShareParityResult.rows[0]?.missing_count
  );
  if (missingShareParityCount > 0) {
    throw new Error(
      `Share read parity guardrail failed: ${missingShareParityCount} vfs_shares rows are missing canonical active ACL parity for item ${itemId}`
    );
  }

  const missingOrgShareParityResult = await queryExecutor.query<{
    missing_count: number | string;
  }>(
    `SELECT COUNT(*)::BIGINT AS missing_count
       FROM org_shares os
       LEFT JOIN vfs_acl_entries acl
         ON acl.item_id = os.item_id
        AND acl.principal_type = 'organization'
        AND acl.principal_id = os.target_org_id
        AND acl.revoked_at IS NULL
        AND acl.access_level = CASE os.permission_level
          WHEN 'edit' THEN 'write'
          ELSE 'read'
        END
        AND acl.granted_by IS NOT DISTINCT FROM os.created_by
        AND acl.expires_at IS NOT DISTINCT FROM os.expires_at
      WHERE os.item_id = $1
        AND acl.id IS NULL`,
    [itemId]
  );
  const missingOrgShareParityCount = parseCount(
    missingOrgShareParityResult.rows[0]?.missing_count
  );
  if (missingOrgShareParityCount > 0) {
    throw new Error(
      `Share read parity guardrail failed: ${missingOrgShareParityCount} org_shares rows are missing canonical active ACL parity for item ${itemId}`
    );
  }
}

/**
 * ACL-first authorization context lookup for legacy share routes.
 *
 * Transition behavior:
 * - Prefer canonical `vfs_acl_entries` row (`share:${shareId}`)
 * - Fail over to legacy `vfs_shares` auth query when canonical row is missing
 */
export async function loadShareAuthorizationContext(
  queryExecutor: QueryExecutor,
  shareId: string
): Promise<ShareAuthorizationContext | null> {
  const canonicalResult = await queryExecutor.query<{
    owner_id: string | null;
    item_id: string;
    principal_type: VfsShareType;
    principal_id: string;
    access_level: VfsAclAccessLevel;
  }>(
    `SELECT
        r.owner_id,
        acl.item_id,
        acl.principal_type,
        acl.principal_id,
        acl.access_level
       FROM vfs_acl_entries acl
       JOIN vfs_registry r
         ON r.id = acl.item_id
      WHERE acl.id = $1
      LIMIT 1`,
    [`share:${shareId}`]
  );
  const canonicalRow = canonicalResult.rows[0];
  if (canonicalRow && isValidShareType(canonicalRow.principal_type)) {
    return {
      ownerId: canonicalRow.owner_id,
      itemId: canonicalRow.item_id,
      shareType: canonicalRow.principal_type,
      targetId: canonicalRow.principal_id,
      accessLevel: parseAclAccessLevel(canonicalRow.access_level),
      source: 'canonical'
    };
  }

  const legacyResult = await queryExecutor.query<{
    owner_id: string | null;
    item_id: string;
    share_type: VfsShareType;
    target_id: string;
    permission_level: VfsPermissionLevel;
  }>(
    `SELECT
        r.owner_id,
        s.item_id,
        s.share_type,
        s.target_id,
        s.permission_level
       FROM vfs_shares s
       JOIN vfs_registry r ON r.id = s.item_id
      WHERE s.id = $1`,
    [shareId]
  );
  const legacyRow = legacyResult.rows[0];
  if (!legacyRow || !isValidShareType(legacyRow.share_type)) {
    return null;
  }

  return {
    ownerId: legacyRow.owner_id,
    itemId: legacyRow.item_id,
    shareType: legacyRow.share_type,
    targetId: legacyRow.target_id,
    accessLevel: mapSharePermissionLevelToAclAccessLevel(
      legacyRow.permission_level
    ),
    source: 'legacy'
  };
}

/**
 * ACL-first authorization context lookup for legacy org-share routes.
 *
 * Transition behavior:
 * - Prefer canonical `vfs_acl_entries` row (`org-share:${shareId}`)
 * - Fail over to legacy `org_shares` auth query when canonical row is missing
 */
export async function loadOrgShareAuthorizationContext(
  queryExecutor: QueryExecutor,
  shareId: string
): Promise<OrgShareAuthorizationContext | null> {
  const canonicalResult = await queryExecutor.query<{
    owner_id: string | null;
    item_id: string;
    principal_id: string;
    access_level: VfsAclAccessLevel;
  }>(
    `SELECT
        r.owner_id,
        acl.item_id,
        acl.principal_id,
        acl.access_level
       FROM vfs_acl_entries acl
       JOIN vfs_registry r
         ON r.id = acl.item_id
      WHERE acl.id = $1
        AND acl.principal_type = 'organization'
      LIMIT 1`,
    [`org-share:${shareId}`]
  );
  const canonicalRow = canonicalResult.rows[0];
  if (canonicalRow) {
    return {
      ownerId: canonicalRow.owner_id,
      itemId: canonicalRow.item_id,
      targetOrgId: canonicalRow.principal_id,
      accessLevel: parseAclAccessLevel(canonicalRow.access_level),
      source: 'canonical'
    };
  }

  const legacyResult = await queryExecutor.query<{
    owner_id: string | null;
    item_id: string;
    target_org_id: string;
    permission_level: VfsPermissionLevel;
  }>(
    `SELECT
        r.owner_id,
        os.item_id,
        os.target_org_id,
        os.permission_level
       FROM org_shares os
       JOIN vfs_registry r ON r.id = os.item_id
      WHERE os.id = $1`,
    [shareId]
  );
  const legacyRow = legacyResult.rows[0];
  if (!legacyRow) {
    return null;
  }

  return {
    ownerId: legacyRow.owner_id,
    itemId: legacyRow.item_id,
    targetOrgId: legacyRow.target_org_id,
    accessLevel: mapSharePermissionLevelToAclAccessLevel(
      legacyRow.permission_level
    ),
    source: 'legacy'
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
