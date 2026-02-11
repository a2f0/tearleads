import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  UpdateVfsShareRequest,
  VfsPermissionLevel,
  VfsShareType
} from '@rapid/shared';
import { isRecord } from '@rapid/shared';

const VALID_SHARE_TYPES: VfsShareType[] = ['user', 'group', 'organization'];
const VALID_PERMISSION_LEVELS: VfsPermissionLevel[] = [
  'view',
  'edit',
  'download'
];

export function isValidShareType(value: unknown): value is VfsShareType {
  return (
    typeof value === 'string' &&
    VALID_SHARE_TYPES.includes(value as VfsShareType)
  );
}

function isValidPermissionLevel(value: unknown): value is VfsPermissionLevel {
  return (
    typeof value === 'string' &&
    VALID_PERMISSION_LEVELS.includes(value as VfsPermissionLevel)
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
