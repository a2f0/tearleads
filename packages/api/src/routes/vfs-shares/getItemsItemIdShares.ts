import type {
  VfsOrgShare,
  VfsShare,
  VfsWrappedKeyPayload,
  VfsSharesResponse,
  VfsShareType
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  extractOrgShareIdFromAclId,
  extractShareIdFromAclId,
  extractSourceOrgIdFromOrgShareAclId,
  mapAclAccessLevelToSharePermissionLevel,
  type VfsAclAccessLevel
} from './shared.js';

interface WrappedKeyMetadata {
  recipientPublicKeyId: string;
  senderSignature: string;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseWrappedKeyMetadata(value: string | null): WrappedKeyMetadata | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!isRecordValue(parsed)) {
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

/**
 * @openapi
 * /vfs/items/{itemId}/shares:
 *   get:
 *     summary: List all shares for a VFS item
 *     description: Returns all shares (user, group, org) and org-to-org shares for the item.
 *     tags:
 *       - VFS Shares
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *         description: The VFS item ID
 *     responses:
 *       200:
 *         description: List of shares
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Item not found
 *       500:
 *         description: Server error
 */
export const getItemsItemidSharesHandler = async (
  req: Request<{ itemId: string }>,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { itemId } = req.params;
    const pool = await getPostgresPool();

    const itemResult = await pool.query<{ owner_id: string | null }>(
      'SELECT owner_id FROM vfs_registry WHERE id = $1',
      [itemId]
    );

    if (!itemResult.rows[0]) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    if (itemResult.rows[0].owner_id !== claims.sub) {
      res
        .status(403)
        .json({ error: 'Not authorized to view shares for this item' });
      return;
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
          CASE
            WHEN acl.principal_type = 'user' THEN (SELECT email FROM users WHERE id = acl.principal_id)
            WHEN acl.principal_type = 'group' THEN (SELECT name FROM groups WHERE id = acl.principal_id)
            WHEN acl.principal_type = 'organization' THEN (SELECT name FROM organizations WHERE id = acl.principal_id)
          END AS target_name,
          (SELECT email FROM users WHERE id = acl.granted_by) AS created_by_email
        FROM vfs_acl_entries acl
        WHERE acl.item_id = $1
          AND acl.id LIKE 'share:%'
          AND acl.revoked_at IS NULL
        ORDER BY acl.created_at DESC`,
      [itemId]
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
      target_org_id: string;
      item_id: string;
      access_level: VfsAclAccessLevel;
      created_by: string | null;
      created_at: Date;
      expires_at: Date | null;
      source_org_name: string | null;
      target_org_name: string | null;
      created_by_email: string | null;
    }>(
      `SELECT
          acl.id AS acl_id,
          acl.principal_id AS target_org_id,
          acl.item_id,
          acl.access_level,
          acl.granted_by AS created_by,
          acl.created_at,
          acl.expires_at,
          (
            SELECT name
            FROM organizations
            WHERE id = split_part(acl.id, ':', 2)
          ) AS source_org_name,
          (SELECT name FROM organizations WHERE id = acl.principal_id) AS target_org_name,
          (SELECT email FROM users WHERE id = acl.granted_by) AS created_by_email
        FROM vfs_acl_entries acl
        WHERE acl.item_id = $1
          AND acl.principal_type = 'organization'
          AND acl.id LIKE 'org-share:%:%'
          AND acl.revoked_at IS NULL
        ORDER BY acl.created_at DESC`,
      [itemId]
    );

    const orgShares: VfsOrgShare[] = orgSharesResult.rows.map((row) => ({
      id: extractOrgShareIdFromAclId(row.acl_id),
      sourceOrgId: extractSourceOrgIdFromOrgShareAclId(row.acl_id),
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
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null
    }));

    const response: VfsSharesResponse = { shares, orgShares };
    res.json(response);
  } catch (error) {
    console.error('Failed to get VFS shares:', error);
    res.status(500).json({ error: 'Failed to get shares' });
  }
};

export function registerGetItemsItemidSharesRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/items/:itemId/shares', getItemsItemidSharesHandler);
}
