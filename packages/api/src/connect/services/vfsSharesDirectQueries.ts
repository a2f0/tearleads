import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  VfsOrgShare,
  VfsOrgWrappedKeyPayload,
  VfsShare,
  VfsShareType,
  VfsWrappedKeyPayload
} from '@tearleads/shared';
import { buildVfsSharesV2ConnectMethodPath, isRecord } from '@tearleads/shared';
import type {
  VfsOrgSharePayload,
  VfsSharePayload,
  VfsSharesGetItemSharesResponse
} from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';
import {
  VfsOrgSharePayloadSchema,
  VfsSharePayloadSchema,
  VfsSharesGetItemSharesResponseSchema
} from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';
import { getPool } from '../../lib/postgres.js';
import { requireVfsSharesClaims } from './vfsSharesDirectHandlers.js';
import {
  extractOrgShareIdFromAclId,
  extractShareIdFromAclId,
  mapAclAccessLevelToSharePermissionLevel,
  type VfsAclAccessLevel
} from './vfsSharesDirectShared.js';

interface WrappedKeyMetadata {
  recipientPublicKeyId: string;
  senderSignature: string;
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
    !Number.isInteger(input.keyEpoch) ||
    !Number.isSafeInteger(input.keyEpoch) ||
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
    !Number.isInteger(input.keyEpoch) ||
    !Number.isSafeInteger(input.keyEpoch) ||
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

function toSharePayload(share: VfsShare): VfsSharePayload {
  return create(VfsSharePayloadSchema, {
    id: share.id,
    itemId: share.itemId,
    shareType: share.shareType,
    targetId: share.targetId,
    targetName: share.targetName,
    permissionLevel: share.permissionLevel,
    createdBy: share.createdBy,
    createdByEmail: share.createdByEmail,
    createdAt: share.createdAt,
    ...(typeof share.expiresAt === 'string'
      ? { expiresAt: share.expiresAt }
      : {}),
    ...(share.wrappedKey ? { wrappedKey: share.wrappedKey } : {})
  });
}

function toOrgSharePayload(orgShare: VfsOrgShare): VfsOrgSharePayload {
  return create(VfsOrgSharePayloadSchema, {
    id: orgShare.id,
    sourceOrgId: orgShare.sourceOrgId,
    sourceOrgName: orgShare.sourceOrgName,
    targetOrgId: orgShare.targetOrgId,
    targetOrgName: orgShare.targetOrgName,
    itemId: orgShare.itemId,
    permissionLevel: orgShare.permissionLevel,
    createdBy: orgShare.createdBy,
    createdByEmail: orgShare.createdByEmail,
    createdAt: orgShare.createdAt,
    ...(typeof orgShare.expiresAt === 'string'
      ? { expiresAt: orgShare.expiresAt }
      : {}),
    ...(orgShare.wrappedKey ? { wrappedKey: orgShare.wrappedKey } : {})
  });
}

export async function getItemSharesDirect(
  request: { itemId: string },
  context: { requestHeader: Headers }
): Promise<VfsSharesGetItemSharesResponse> {
  const claims = await requireVfsSharesClaims(
    buildVfsSharesV2ConnectMethodPath('GetItemShares'),
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const itemResult = await pool.query<{ owner_id: string | null }>(
      'SELECT owner_id FROM vfs_registry WHERE id = $1',
      [request.itemId]
    );

    if (!itemResult.rows[0]) {
      throw new ConnectError('Item not found', Code.NotFound);
    }
    if (itemResult.rows[0].owner_id !== claims.sub) {
      throw new ConnectError(
        'Not authorized to view shares for this item',
        Code.PermissionDenied
      );
    }

    const sharesResult = await pool.query<{
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
    }>(
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
          COALESCE(u.email, g.name, o.name) AS target_name,
          creator.email AS created_by_email
        FROM vfs_acl_entries acl
        LEFT JOIN users u ON acl.principal_type = 'user' AND u.id = acl.principal_id
        LEFT JOIN groups g ON acl.principal_type = 'group' AND g.id = acl.principal_id
        LEFT JOIN organizations o ON acl.principal_type = 'organization' AND o.id = acl.principal_id
        LEFT JOIN users creator ON creator.id = acl.granted_by
        WHERE acl.item_id = $1::uuid
          AND acl.principal_type IN ('user', 'group')
          AND acl.revoked_at IS NULL
        ORDER BY acl.created_at DESC`,
      [request.itemId]
    );

    const shares: VfsShare[] = sharesResult.rows.map((row) => {
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
        ...(wrappedKey !== null && { wrappedKey })
      };
    });

    const orgSharesResult = await pool.query<{
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
    }>(
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
      [request.itemId]
    );

    const orgShares: VfsOrgShare[] = orgSharesResult.rows.map((row) => {
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
        ...(wrappedKey !== null && { wrappedKey })
      };
    });

    return create(VfsSharesGetItemSharesResponseSchema, {
      shares: shares.map((share) => toSharePayload(share)),
      orgShares: orgShares.map((orgShare) => toOrgSharePayload(orgShare))
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to get VFS shares:', error);
    throw new ConnectError('Failed to get shares', Code.Internal);
  }
}
