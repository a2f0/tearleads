import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { isRecord, type VfsOrgShare } from '@tearleads/shared';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  buildOrgShareAclId,
  extractOrgShareIdFromAclId,
  extractSourceOrgIdFromOrgShareAclId,
  mapAclAccessLevelToSharePermissionLevel,
  mapSharePermissionLevelToAclAccessLevel,
  parseCreateOrgSharePayload,
  type VfsAclAccessLevel
} from '../../routes/vfs-shares/shared.js';
import { requireVfsSharesClaims } from './vfsSharesDirectHandlers.js';

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function parseJsonBody(json: string): unknown {
  const normalized = json.trim().length > 0 ? json : '{}';
  try {
    return JSON.parse(normalized);
  } catch {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }
}

export async function createOrgShareDirect(
  request: { itemId: string; json: string },
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsSharesClaims(
    `/vfs/items/${encoded(request.itemId)}/org-shares`,
    context.requestHeader
  );

  const parsedBody = parseJsonBody(request.json);
  const payload = parseCreateOrgSharePayload({
    ...(isRecord(parsedBody) ? parsedBody : {}),
    itemId: request.itemId
  });
  if (!payload) {
    throw new ConnectError(
      'sourceOrgId, targetOrgId, and permissionLevel are required',
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

    const sourceOrgResult = await pool.query<{ name: string }>(
      `SELECT o.name
         FROM organizations o
         INNER JOIN user_organizations uo
           ON uo.organization_id = o.id
        WHERE o.id = $1
          AND uo.user_id = $2
        LIMIT 1`,
      [payload.sourceOrgId, claims.sub]
    );
    if (!sourceOrgResult.rows[0]) {
      throw new ConnectError('Source organization not found', Code.NotFound);
    }
    const sourceOrgName = sourceOrgResult.rows[0].name;

    const targetOrgResult = await pool.query<{ name: string }>(
      'SELECT name FROM organizations WHERE id = $1',
      [payload.targetOrgId]
    );
    if (!targetOrgResult.rows[0]) {
      throw new ConnectError('Target organization not found', Code.NotFound);
    }
    const targetOrgName = targetOrgResult.rows[0].name;

    const shareId = randomUUID();
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
      target_org_id: string;
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
          principal_id AS target_org_id,
          access_level,
          granted_by AS created_by,
          created_at,
          expires_at`,
      [
        buildOrgShareAclId(payload.sourceOrgId, shareId),
        payload.itemId,
        'organization',
        payload.targetOrgId,
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
      throw new ConnectError('Org share already exists', Code.AlreadyExists);
    }

    const creatorId = row.created_by ?? claims.sub;
    const creatorResult = await pool.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [creatorId]
    );

    const orgShare: VfsOrgShare = {
      id: extractOrgShareIdFromAclId(row.acl_id),
      sourceOrgId: extractSourceOrgIdFromOrgShareAclId(row.acl_id),
      sourceOrgName,
      targetOrgId: row.target_org_id,
      targetOrgName,
      itemId: row.item_id,
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
      json: JSON.stringify({ orgShare })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to create org share:', error);
    if (
      error instanceof Error &&
      error.message.includes('duplicate key value violates unique constraint')
    ) {
      throw new ConnectError('Org share already exists', Code.AlreadyExists);
    }
    throw new ConnectError('Failed to create org share', Code.Internal);
  }
}
