import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { isRecord, type VfsShare, type VfsShareType } from '@tearleads/shared';
import { getPostgresPool } from '../../lib/postgres.js';
import { requireVfsSharesClaims } from './vfsSharesDirectHandlers.js';
import {
  buildShareAclId,
  extractShareIdFromAclId,
  loadShareAuthorizationContext,
  mapAclAccessLevelToSharePermissionLevel,
  mapSharePermissionLevelToAclAccessLevel,
  parseCreateSharePayload,
  parseUpdateSharePayload,
  type VfsAclAccessLevel
} from './vfsSharesDirectShared.js';

function parseJsonBody(json: string): unknown {
  const normalized = json.trim().length > 0 ? json : '{}';
  try {
    return JSON.parse(normalized);
  } catch {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export async function updateShareDirect(
  request: { shareId: string; json: string },
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsSharesClaims(
    `/vfs/shares/${encoded(request.shareId)}`,
    context.requestHeader
  );
  const payload = parseUpdateSharePayload(parseJsonBody(request.json));

  if (!payload) {
    throw new ConnectError('Invalid update payload', Code.InvalidArgument);
  }
  if (
    payload.permissionLevel === undefined &&
    payload.expiresAt === undefined
  ) {
    throw new ConnectError('No fields to update', Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();
    const authContext = await loadShareAuthorizationContext(
      pool,
      request.shareId
    );
    if (!authContext) {
      throw new ConnectError('Share not found', Code.NotFound);
    }
    if (authContext.ownerId !== claims.sub) {
      throw new ConnectError(
        'Not authorized to update this share',
        Code.PermissionDenied
      );
    }

    const updates: string[] = [];
    const values: (string | Date | null)[] = [];
    let paramIndex = 1;

    if (payload.permissionLevel !== undefined) {
      updates.push(`access_level = $${paramIndex++}`);
      values.push(
        mapSharePermissionLevelToAclAccessLevel(payload.permissionLevel)
      );
    }

    if (payload.expiresAt !== undefined) {
      updates.push(`expires_at = $${paramIndex++}`);
      values.push(payload.expiresAt ? new Date(payload.expiresAt) : null);
    }

    const now = new Date();
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);
    values.push(authContext.aclId);

    const result = await pool.query<{
      acl_id: string;
      item_id: string;
      share_type: VfsShareType;
      target_id: string;
      access_level: VfsAclAccessLevel;
      created_by: string | null;
      created_at: Date;
      expires_at: Date | null;
    }>(
      `UPDATE vfs_acl_entries
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
           AND revoked_at IS NULL
         RETURNING
           id AS acl_id,
           item_id,
           principal_type AS share_type,
           principal_id AS target_id,
           access_level,
           granted_by AS created_by,
           created_at,
           expires_at`,
      values
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Share not found', Code.NotFound);
    }

    let targetName = 'Unknown';
    if (row.share_type === 'user') {
      const lookup = await pool.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [row.target_id]
      );
      targetName = lookup.rows[0]?.email ?? 'Unknown';
    } else if (row.share_type === 'group') {
      const lookup = await pool.query<{ name: string }>(
        'SELECT name FROM groups WHERE id = $1',
        [row.target_id]
      );
      targetName = lookup.rows[0]?.name ?? 'Unknown';
    } else if (row.share_type === 'organization') {
      const lookup = await pool.query<{ name: string }>(
        'SELECT name FROM organizations WHERE id = $1',
        [row.target_id]
      );
      targetName = lookup.rows[0]?.name ?? 'Unknown';
    }

    const creatorId = row.created_by ?? 'unknown';
    const creatorEmail =
      row.created_by === null
        ? 'Unknown'
        : ((
            await pool.query<{ email: string }>(
              'SELECT email FROM users WHERE id = $1',
              [row.created_by]
            )
          ).rows[0]?.email ?? 'Unknown');

    const share: VfsShare = {
      id: extractShareIdFromAclId(row.acl_id),
      itemId: row.item_id,
      shareType: row.share_type,
      targetId: row.target_id,
      targetName,
      permissionLevel: mapAclAccessLevelToSharePermissionLevel(
        row.access_level
      ),
      createdBy: creatorId,
      createdByEmail: creatorEmail,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null
    };

    return {
      json: JSON.stringify({ share })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to update VFS share:', error);
    throw new ConnectError('Failed to update share', Code.Internal);
  }
}

export async function createShareDirect(
  request: { itemId: string; json: string },
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsSharesClaims(
    `/vfs/items/${encoded(request.itemId)}/shares`,
    context.requestHeader
  );

  const parsedBody = parseJsonBody(request.json);
  const payload = parseCreateSharePayload({
    ...(isRecord(parsedBody) ? parsedBody : {}),
    itemId: request.itemId
  });

  if (!payload) {
    throw new ConnectError(
      'shareType, targetId, and permissionLevel are required',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();
    const itemResult = await pool.query<{
      id: string;
      owner_id: string | null;
    }>('SELECT id, owner_id FROM vfs_registry WHERE id = $1', [payload.itemId]);
    if (!itemResult.rows[0]) {
      throw new ConnectError('Item not found', Code.NotFound);
    }
    if (itemResult.rows[0].owner_id !== claims.sub) {
      throw new ConnectError(
        'Not authorized to share this item',
        Code.PermissionDenied
      );
    }

    let targetExists = false;
    let targetName = 'Unknown';
    if (payload.shareType === 'user') {
      const result = await pool.query<{ email: string }>(
        `SELECT u.email
           FROM users u
          WHERE u.id = $1
            AND EXISTS (
              SELECT 1
                FROM user_organizations requestor_uo
                INNER JOIN user_organizations target_uo
                  ON target_uo.organization_id = requestor_uo.organization_id
               WHERE requestor_uo.user_id = $2
                 AND target_uo.user_id = u.id
            )
          LIMIT 1`,
        [payload.targetId, claims.sub]
      );
      if (result.rows[0]) {
        targetExists = true;
        targetName = result.rows[0].email;
      }
    } else if (payload.shareType === 'group') {
      const result = await pool.query<{ name: string }>(
        `SELECT g.name
           FROM groups g
           INNER JOIN user_organizations uo
             ON uo.organization_id = g.organization_id
          WHERE g.id = $1
            AND uo.user_id = $2
          LIMIT 1`,
        [payload.targetId, claims.sub]
      );
      if (result.rows[0]) {
        targetExists = true;
        targetName = result.rows[0].name;
      }
    } else if (payload.shareType === 'organization') {
      const result = await pool.query<{ name: string }>(
        `SELECT o.name
           FROM organizations o
           INNER JOIN user_organizations uo
             ON uo.organization_id = o.id
          WHERE o.id = $1
            AND uo.user_id = $2
          LIMIT 1`,
        [payload.targetId, claims.sub]
      );
      if (result.rows[0]) {
        targetExists = true;
        targetName = result.rows[0].name;
      }
    }

    if (!targetExists) {
      throw new ConnectError(`${payload.shareType} not found`, Code.NotFound);
    }

    const shareId = randomUUID();
    const aclId = buildShareAclId(shareId);
    const now = new Date();
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    const wrappedKey = payload.wrappedKey ?? null;
    const wrappedKeyMetadata =
      wrappedKey === null
        ? null
        : JSON.stringify({
            recipientPublicKeyId: wrappedKey.recipientPublicKeyId,
            senderSignature: wrappedKey.senderSignature
          });

    const result = await pool.query<{
      acl_id: string;
      item_id: string;
      share_type: VfsShareType;
      target_id: string;
      access_level: VfsAclAccessLevel;
      created_by: string | null;
      created_at: Date;
      expires_at: Date | null;
    }>(
      `INSERT INTO vfs_acl_entries (
          id,
          item_id,
          principal_type,
          principal_id,
          access_level,
          wrapped_session_key,
          wrapped_hierarchical_key,
          key_epoch,
          granted_by,
          created_at,
          updated_at,
          expires_at,
          revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, NULL)
        ON CONFLICT (item_id, principal_type, principal_id)
        DO UPDATE SET
          id = EXCLUDED.id,
          access_level = EXCLUDED.access_level,
          wrapped_session_key = EXCLUDED.wrapped_session_key,
          wrapped_hierarchical_key = EXCLUDED.wrapped_hierarchical_key,
          key_epoch = EXCLUDED.key_epoch,
          granted_by = EXCLUDED.granted_by,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          expires_at = EXCLUDED.expires_at,
          revoked_at = NULL
        WHERE vfs_acl_entries.revoked_at IS NOT NULL
        RETURNING
          id AS acl_id,
          item_id,
          principal_type AS share_type,
          principal_id AS target_id,
          access_level,
          granted_by AS created_by,
          created_at,
          expires_at`,
      [
        aclId,
        payload.itemId,
        payload.shareType,
        payload.targetId,
        mapSharePermissionLevelToAclAccessLevel(payload.permissionLevel),
        wrappedKey?.encryptedKey ?? null,
        wrappedKeyMetadata,
        wrappedKey?.keyEpoch ?? null,
        claims.sub,
        now,
        expiresAt
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Share already exists', Code.AlreadyExists);
    }

    const creatorId = row.created_by ?? claims.sub;
    const creatorResult = await pool.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [creatorId]
    );

    const share: VfsShare = {
      id: extractShareIdFromAclId(row.acl_id),
      itemId: row.item_id,
      shareType: row.share_type,
      targetId: row.target_id,
      targetName,
      permissionLevel: mapAclAccessLevelToSharePermissionLevel(
        row.access_level
      ),
      createdBy: creatorId,
      createdByEmail: creatorResult.rows[0]?.email ?? 'Unknown',
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      ...(wrappedKey !== null && { wrappedKey })
    };

    return {
      json: JSON.stringify({ share })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to create VFS share:', error);
    if (
      error instanceof Error &&
      error.message.includes('duplicate key value violates unique constraint')
    ) {
      throw new ConnectError('Share already exists', Code.AlreadyExists);
    }
    throw new ConnectError('Failed to create share', Code.Internal);
  }
}
