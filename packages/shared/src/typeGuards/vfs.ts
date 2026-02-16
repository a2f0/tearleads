import { isRecord } from '../typeGuards.js';

/** Result shape for items shared by the current user. */
export interface VfsSharedByMeQueryRow {
  id: string;
  objectType: string;
  name: string;
  createdAt: Date;
  shareId: string;
  targetId: string;
  targetName: string;
  shareType: string;
  permissionLevel: string;
  sharedAt: Date;
  expiresAt: Date | null;
}

/** Result shape for items shared with the current user. */
export interface VfsSharedWithMeQueryRow {
  id: string;
  objectType: string;
  name: string;
  createdAt: Date;
  shareId: string;
  sharedById: string;
  sharedByEmail: string;
  shareType: string;
  permissionLevel: string;
  sharedAt: Date;
  expiresAt: Date | null;
}

/**
 * Type guard for VfsSharedByMeQueryRow.
 */
export function isVfsSharedByMeQueryRow(
  value: unknown
): value is VfsSharedByMeQueryRow {
  if (!isRecord(value)) return false;

  return (
    typeof value['id'] === 'string' &&
    typeof value['objectType'] === 'string' &&
    typeof value['name'] === 'string' &&
    value['createdAt'] instanceof Date &&
    typeof value['shareId'] === 'string' &&
    typeof value['targetId'] === 'string' &&
    typeof value['targetName'] === 'string' &&
    typeof value['shareType'] === 'string' &&
    typeof value['permissionLevel'] === 'string' &&
    value['sharedAt'] instanceof Date &&
    (value['expiresAt'] === null || value['expiresAt'] instanceof Date)
  );
}

/**
 * Type guard for VfsSharedWithMeQueryRow.
 */
export function isVfsSharedWithMeQueryRow(
  value: unknown
): value is VfsSharedWithMeQueryRow {
  if (!isRecord(value)) return false;

  return (
    typeof value['id'] === 'string' &&
    typeof value['objectType'] === 'string' &&
    typeof value['name'] === 'string' &&
    value['createdAt'] instanceof Date &&
    typeof value['shareId'] === 'string' &&
    typeof value['sharedById'] === 'string' &&
    typeof value['sharedByEmail'] === 'string' &&
    typeof value['shareType'] === 'string' &&
    typeof value['permissionLevel'] === 'string' &&
    value['sharedAt'] instanceof Date &&
    (value['expiresAt'] === null || value['expiresAt'] instanceof Date)
  );
}
