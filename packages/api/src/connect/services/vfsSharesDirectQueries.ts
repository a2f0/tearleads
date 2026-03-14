import type {
  VfsAclAccessLevel,
  VfsOrgShare,
  VfsOrgWrappedKeyPayload,
  VfsShare,
  VfsSharePolicyPreviewRequest,
  VfsShareType,
  VfsWrappedKeyPayload
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import { mapAclAccessLevelToSharePermissionLevel } from './vfsDirectCrdtRouteHelpers.js';
import {
  extractOrgShareIdFromAclId,
  extractShareIdFromAclId
} from './vfsSharesDirectShared.js';

interface WrappedKeyMetadata {
  recipientPublicKeyId: string;
  senderSignature: string;
}

interface UserShareRow {
  acl_id: string;
  item_id: string;
  share_type: VfsShareType;
  target_id: string;
  access_level: VfsAclAccessLevel;
  created_by: string | null;
  created_at: Date;
  expires_at: Date | null;
  target_name: string | null;
  created_by_email: string | null;
  wrapped_session_key: string | null;
  wrapped_hierarchical_key: string | null;
  key_epoch: number | null;
}

interface OrgShareRow {
  acl_id: string;
  source_org_id: string;
  target_org_id: string;
  item_id: string;
  access_level: VfsAclAccessLevel;
  created_by: string | null;
  created_at: Date;
  expires_at: Date | null;
  source_org_name: string | null;
  target_org_name: string | null;
  created_by_email: string | null;
  wrapped_session_key: string | null;
  wrapped_hierarchical_key: string | null;
  key_epoch: number | null;
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

function isVfsAclAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return value === 'read' || value === 'write' || value === 'admin';
}

function isVfsShareType(value: unknown): value is VfsShareType {
  return value === 'user' || value === 'group';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableDate(value: unknown): value is Date | null {
  return value === null || value instanceof Date;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isUserShareRow(value: unknown): value is UserShareRow {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['acl_id'] === 'string' &&
    typeof value['item_id'] === 'string' &&
    isVfsShareType(value['share_type']) &&
    typeof value['target_id'] === 'string' &&
    isVfsAclAccessLevel(value['access_level']) &&
    isNullableString(value['created_by']) &&
    value['created_at'] instanceof Date &&
    isNullableDate(value['expires_at']) &&
    isNullableString(value['target_name']) &&
    isNullableString(value['created_by_email']) &&
    isNullableString(value['wrapped_session_key']) &&
    isNullableString(value['wrapped_hierarchical_key']) &&
    isNullableNumber(value['key_epoch'])
  );
}

function isOrgShareRow(value: unknown): value is OrgShareRow {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['acl_id'] === 'string' &&
    typeof value['source_org_id'] === 'string' &&
    typeof value['target_org_id'] === 'string' &&
    typeof value['item_id'] === 'string' &&
    isVfsAclAccessLevel(value['access_level']) &&
    isNullableString(value['created_by']) &&
    value['created_at'] instanceof Date &&
    isNullableDate(value['expires_at']) &&
    isNullableString(value['source_org_name']) &&
    isNullableString(value['target_org_name']) &&
    isNullableString(value['created_by_email']) &&
    isNullableString(value['wrapped_session_key']) &&
    isNullableString(value['wrapped_hierarchical_key']) &&
    isNullableNumber(value['key_epoch'])
  );
}

function parseWrappedKeyMetadata(
  value: string | null
): WrappedKeyMetadata | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) {
      return null;
    }

    const recipientPublicKeyId = parsed['recipientPublicKeyId'];
    const senderSignature = parsed['senderSignature'];
    if (
      typeof recipientPublicKeyId !== 'string' ||
      !recipientPublicKeyId.trim() ||
      typeof senderSignature !== 'string' ||
      !senderSignature.trim()
    ) {
      return null;
    }

    return {
      recipientPublicKeyId: recipientPublicKeyId.trim(),
      senderSignature: senderSignature.trim()
    };
  } catch {
    return null;
  }
}

function buildWrappedKeyForShare(input: {
  shareType: VfsShareType;
  targetId: string;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  keyEpoch: number | null;
}): VfsWrappedKeyPayload | null {
  if (input.shareType !== 'user') {
    return null;
  }
  if (
    typeof input.wrappedSessionKey !== 'string' ||
    !input.wrappedSessionKey.trim() ||
    typeof input.keyEpoch !== 'number' ||
    input.keyEpoch < 1
  ) {
    return null;
  }

  const metadata = parseWrappedKeyMetadata(input.wrappedHierarchicalKey);
  if (!metadata) {
    return null;
  }

  return {
    recipientUserId: input.targetId,
    recipientPublicKeyId: metadata.recipientPublicKeyId,
    keyEpoch: input.keyEpoch,
    encryptedKey: input.wrappedSessionKey,
    senderSignature: metadata.senderSignature
  };
}

function buildWrappedKeyForOrgShare(input: {
  targetOrgId: string;
  wrappedSessionKey: string | null;
  wrappedHierarchicalKey: string | null;
  keyEpoch: number | null;
}): VfsOrgWrappedKeyPayload | null {
  if (
    typeof input.wrappedSessionKey !== 'string' ||
    !input.wrappedSessionKey.trim() ||
    typeof input.keyEpoch !== 'number' ||
    input.keyEpoch < 1
  ) {
    return null;
  }

  const metadata = parseWrappedKeyMetadata(input.wrappedHierarchicalKey);
  if (!metadata) {
    return null;
  }

  return {
    recipientOrgId: input.targetOrgId,
    recipientPublicKeyId: metadata.recipientPublicKeyId,
    keyEpoch: input.keyEpoch,
    encryptedKey: input.wrappedSessionKey,
    senderSignature: metadata.senderSignature
  };
}

export async function loadUserShares(
  pool: Queryable,
  itemId: string
): Promise<VfsShare[]> {
  const result = await pool.query(
    `SELECT
        acl.id AS acl_id,
        acl.item_id,
        acl.principal_type AS share_type,
        acl.principal_id AS target_id,
        acl.access_level,
        acl.granted_by AS created_by,
        acl.created_at,
        acl.expires_at,
        acl.wrapped_session_key,
        acl.wrapped_hierarchical_key,
        acl.key_epoch,
        COALESCE(u.email, g.name) AS target_name,
        creator.email AS created_by_email
      FROM vfs_acl_entries acl
      LEFT JOIN users u ON acl.principal_type = 'user' AND u.id = acl.principal_id
      LEFT JOIN groups g ON acl.principal_type = 'group' AND g.id = acl.principal_id
      LEFT JOIN users creator ON creator.id = acl.granted_by
      WHERE acl.item_id = $1::uuid
        AND acl.principal_type IN ('user', 'group')
        AND acl.revoked_at IS NULL
      ORDER BY acl.created_at DESC`,
    [itemId]
  );

  return result.rows.filter(isUserShareRow).map((row) => {
    const wrappedKey = buildWrappedKeyForShare({
      shareType: row.share_type,
      targetId: row.target_id,
      wrappedSessionKey: row.wrapped_session_key,
      wrappedHierarchicalKey: row.wrapped_hierarchical_key,
      keyEpoch: row.key_epoch
    });

    return {
      id: extractShareIdFromAclId(row.acl_id),
      itemId: row.item_id,
      shareType: row.share_type,
      targetId: row.target_id,
      targetName: row.target_name ?? 'Unknown',
      permissionLevel: mapAclAccessLevelToSharePermissionLevel(
        row.access_level
      ),
      createdBy: row.created_by ?? 'unknown',
      createdByEmail: row.created_by_email ?? 'Unknown',
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      ...(wrappedKey ? { wrappedKey } : {})
    };
  });
}

export async function loadOrgShares(
  pool: Queryable,
  itemId: string
): Promise<VfsOrgShare[]> {
  const result = await pool.query(
    `SELECT
        acl.id AS acl_id,
        r.organization_id AS source_org_id,
        acl.principal_id AS target_org_id,
        acl.item_id,
        acl.access_level,
        acl.granted_by AS created_by,
        acl.created_at,
        acl.expires_at,
        acl.wrapped_session_key,
        acl.wrapped_hierarchical_key,
        acl.key_epoch,
        source_org.name AS source_org_name,
        target_org.name AS target_org_name,
        creator.email AS created_by_email
      FROM vfs_acl_entries acl
      JOIN vfs_registry r ON r.id = acl.item_id
      LEFT JOIN organizations source_org ON source_org.id = r.organization_id
      LEFT JOIN organizations target_org ON target_org.id = acl.principal_id
      LEFT JOIN users creator ON creator.id = acl.granted_by
      WHERE acl.item_id = $1::uuid
        AND acl.principal_type = 'organization'
        AND acl.revoked_at IS NULL
      ORDER BY acl.created_at DESC`,
    [itemId]
  );

  return result.rows.filter(isOrgShareRow).map((row) => {
    const wrappedKey = buildWrappedKeyForOrgShare({
      targetOrgId: row.target_org_id,
      wrappedSessionKey: row.wrapped_session_key,
      wrappedHierarchicalKey: row.wrapped_hierarchical_key,
      keyEpoch: row.key_epoch
    });

    return {
      id: extractOrgShareIdFromAclId(row.acl_id),
      sourceOrgId: row.source_org_id,
      sourceOrgName: row.source_org_name ?? 'Unknown',
      targetOrgId: row.target_org_id,
      targetOrgName: row.target_org_name ?? 'Unknown',
      itemId: row.item_id,
      permissionLevel: mapAclAccessLevelToSharePermissionLevel(
        row.access_level
      ),
      createdBy: row.created_by ?? 'unknown',
      createdByEmail: row.created_by_email ?? 'Unknown',
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      ...(wrappedKey ? { wrappedKey } : {})
    };
  });
}

export async function loadSharePolicyPreview(
  _pool: Queryable,
  _userId: string,
  _request: VfsSharePolicyPreviewRequest
): Promise<{
  nodes: Array<{
    itemId: string;
    objectType: string;
    depth: number;
    path: string;
    state: string;
    effectiveAccessLevel: VfsAclAccessLevel | null;
    sourcePolicyIds: string[];
  }>;
  summary: {
    totalMatchingNodes: number;
    returnedNodes: number;
    directCount: number;
    derivedCount: number;
    deniedCount: number;
    includedCount: number;
    excludedCount: number;
  };
  nextCursor: string | null;
}> {
  // Minimal mock implementation
  return {
    nodes: [],
    summary: {
      totalMatchingNodes: 0,
      returnedNodes: 0,
      directCount: 0,
      derivedCount: 0,
      deniedCount: 0,
      includedCount: 0,
      excludedCount: 0
    },
    nextCursor: null
  };
}
