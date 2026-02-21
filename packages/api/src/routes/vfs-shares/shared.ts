import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  UpdateVfsShareRequest,
  VfsPermissionLevel,
  VfsShareType,
  VfsWrappedKeyPayload
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

function normalizeAclIdPart(value: string): string {
  return value.trim();
}

function isValidAclIdPart(value: string): boolean {
  const normalized = normalizeAclIdPart(value);
  return normalized.length > 0 && !normalized.includes(':');
}

function requireAclIdPart(value: string, partName: string): string {
  const normalized = normalizeAclIdPart(value);
  if (!isValidAclIdPart(normalized)) {
    throw new Error(`Unsupported ${partName} in share ACL identifier`);
  }

  return normalized;
}

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
  sourceOrgId: string;
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
  sourceOrgId: string;
} {
  if (!aclId.startsWith(ORG_SHARE_ID_PREFIX)) {
    throw new Error('Unsupported ACL id in org-share authorization context');
  }

  const suffix = aclId.slice(ORG_SHARE_ID_PREFIX.length);
  if (!suffix) {
    throw new Error('Unsupported ACL id in org-share authorization context');
  }

  const [firstPart, secondPart, ...remainingParts] = suffix.split(':');
  if (!firstPart) {
    throw new Error('Unsupported ACL id in org-share authorization context');
  }

  if (secondPart === undefined || remainingParts.length > 0) {
    throw new Error('Unsupported ACL id in org-share authorization context');
  }

  return {
    sourceOrgId: requireAclIdPart(firstPart, 'org-share source org id'),
    shareId: requireAclIdPart(secondPart, 'org-share id')
  };
}

export function buildShareAclId(shareId: string): string {
  return `${SHARE_ID_PREFIX}${requireAclIdPart(shareId, 'share id')}`;
}

export function buildOrgShareAclId(
  sourceOrgId: string,
  shareId: string
): string {
  return `${ORG_SHARE_ID_PREFIX}${requireAclIdPart(
    sourceOrgId,
    'org-share source org id'
  )}:${requireAclIdPart(shareId, 'org-share id')}`;
}

export function extractShareIdFromAclId(aclId: string): string {
  if (!aclId.startsWith(SHARE_ID_PREFIX)) {
    throw new Error('Unsupported ACL id in share response mapping');
  }

  return requireAclIdPart(aclId.slice(SHARE_ID_PREFIX.length), 'share id');
}

export function extractOrgShareIdFromAclId(aclId: string): string {
  return parseOrgShareAclId(aclId).shareId;
}

export function extractSourceOrgIdFromOrgShareAclId(aclId: string): string {
  return parseOrgShareAclId(aclId).sourceOrgId;
}

export async function loadShareAuthorizationContext(
  queryExecutor: QueryExecutor,
  shareId: string
): Promise<ShareAuthorizationContext | null> {
  if (!isValidAclIdPart(shareId)) {
    return null;
  }

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
  if (!isValidAclIdPart(shareId)) {
    return null;
  }

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
        AND acl.id LIKE 'org-share:%:%'
        AND split_part(acl.id, ':', 3) = $1
      ORDER BY acl.created_at DESC
      LIMIT 2`,
    [shareId]
  );

  /**
   * Guardrail: one org-share route id must resolve to at most one active ACL
   * row. Multiple matches indicate malformed/duplicated ids and are rejected.
   */
  if (canonicalResult.rows.length > 1) {
    throw new Error('Ambiguous org-share ACL authorization context');
  }

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

function parseWrappedKeyPayload(value: unknown): VfsWrappedKeyPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const recipientUserId = value['recipientUserId'];
  const recipientPublicKeyId = value['recipientPublicKeyId'];
  const keyEpoch = value['keyEpoch'];
  const encryptedKey = value['encryptedKey'];
  const senderSignature = value['senderSignature'];

  if (
    typeof recipientUserId !== 'string' ||
    typeof recipientPublicKeyId !== 'string' ||
    typeof keyEpoch !== 'number' ||
    !Number.isInteger(keyEpoch) ||
    !Number.isSafeInteger(keyEpoch) ||
    keyEpoch < 1 ||
    typeof encryptedKey !== 'string' ||
    typeof senderSignature !== 'string'
  ) {
    return null;
  }

  if (
    !recipientUserId.trim() ||
    !recipientPublicKeyId.trim() ||
    !encryptedKey.trim() ||
    !senderSignature.trim()
  ) {
    return null;
  }

  return {
    recipientUserId: recipientUserId.trim(),
    recipientPublicKeyId: recipientPublicKeyId.trim(),
    keyEpoch,
    encryptedKey: encryptedKey.trim(),
    senderSignature: senderSignature.trim()
  };
}

export function parseCreateSharePayload(
  body: unknown
): CreateVfsShareRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const {
    itemId,
    shareType,
    targetId,
    permissionLevel,
    expiresAt,
    wrappedKey: wrappedKeyValue
  } = body;

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

  const wrappedKey =
    wrappedKeyValue === undefined || wrappedKeyValue === null
      ? null
      : parseWrappedKeyPayload(wrappedKeyValue);
  if (
    wrappedKeyValue !== undefined &&
    wrappedKeyValue !== null &&
    !wrappedKey
  ) {
    return null;
  }

  if (
    wrappedKey &&
    (shareType !== 'user' || wrappedKey.recipientUserId !== targetId.trim())
  ) {
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
        : null,
    wrappedKey
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

  /**
   * Guardrail: source-org is encoded into canonical ACL ids. We reject values
   * that would produce ambiguous identifiers before touching persistence.
   */
  if (!isValidAclIdPart(sourceOrgId)) {
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
