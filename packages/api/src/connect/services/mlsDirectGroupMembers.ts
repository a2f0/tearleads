import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  AddMlsMemberResponse,
  MlsGroupMember,
  MlsGroupMembersResponse
} from '@tearleads/shared';
import { broadcast } from '../../lib/broadcast.js';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import {
  getActiveMlsGroupMembership,
  parseAddMemberPayload,
  parseRemoveMemberPayload
} from '../../routes/mls/shared.js';
import { requireMlsClaims } from './mlsDirectAuth.js';

type GroupIdRequest = { groupId: string };
type AddMemberRequest = { groupId: string; json: string };
type RemoveMemberRequest = { groupId: string; userId: string; json: string };

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

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export async function addGroupMemberDirect(
  request: AddMemberRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/members`,
    context.requestHeader
  );

  const payload = parseAddMemberPayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError('Invalid add member payload', Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      throw new ConnectError(
        'Not a member of this group',
        Code.PermissionDenied
      );
    }

    if (membership.role !== 'admin') {
      throw new ConnectError(
        'Only admins can add members',
        Code.PermissionDenied
      );
    }

    const targetOrganizationMembership = await pool.query(
      `SELECT 1
         FROM user_organizations
        WHERE user_id = $1
          AND organization_id = $2
        LIMIT 1`,
      [payload.userId, membership.organizationId]
    );

    if (targetOrganizationMembership.rows.length === 0) {
      throw new ConnectError('User not found', Code.NotFound);
    }

    const client = await pool.connect();
    let inTransaction = false;
    let welcomeId = '';
    let leafIndex = 0;
    const now = new Date();

    try {
      await client.query('BEGIN');
      inTransaction = true;

      const epochResult = await client.query<{ current_epoch: number }>(
        `SELECT current_epoch
           FROM mls_groups
          WHERE id = $1
          FOR UPDATE`,
        [groupId]
      );
      const currentEpoch = epochResult.rows[0]?.current_epoch;
      if (typeof currentEpoch !== 'number') {
        throw new ConnectError('Group not found', Code.NotFound);
      }

      const expectedEpoch = currentEpoch + 1;
      if (payload.newEpoch !== expectedEpoch) {
        throw new ConnectError('Epoch mismatch', Code.AlreadyExists);
      }

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count
           FROM mls_group_members
          WHERE group_id = $1`,
        [groupId]
      );
      leafIndex = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const keyPackageResult = await client.query<{ id: string }>(
        `UPDATE mls_key_packages
            SET consumed_at = NOW(), consumed_by_group_id = $1
          WHERE key_package_ref = $2
            AND user_id = $3
            AND consumed_at IS NULL
            AND EXISTS (
              SELECT 1
                FROM user_organizations
               WHERE user_id = $3
                 AND organization_id = $4
            )
        RETURNING id`,
        [
          groupId,
          payload.keyPackageRef,
          payload.userId,
          membership.organizationId
        ]
      );

      if (keyPackageResult.rowCount === 0) {
        throw new ConnectError('Key package not available', Code.AlreadyExists);
      }

      await client.query(
        `INSERT INTO mls_group_members (
           group_id,
           user_id,
           leaf_index,
           role,
           joined_at,
           joined_at_epoch
         ) VALUES ($1, $2, $3, 'member', $4, $5)`,
        [groupId, payload.userId, leafIndex, now, payload.newEpoch]
      );

      welcomeId = randomUUID();
      await client.query(
        `INSERT INTO mls_welcome_messages (
           id,
           group_id,
           recipient_user_id,
           key_package_ref,
           welcome_data,
           epoch,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          welcomeId,
          groupId,
          payload.userId,
          payload.keyPackageRef,
          payload.welcome,
          payload.newEpoch
        ]
      );

      const commitId = randomUUID();
      await client.query(
        `INSERT INTO mls_messages (
           id,
           group_id,
           sender_user_id,
           epoch,
           ciphertext,
           message_type,
           sequence_number,
           created_at
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           'commit',
           COALESCE((SELECT MAX(sequence_number) FROM mls_messages WHERE group_id = $2), 0) + 1,
           NOW()
         )`,
        [commitId, groupId, claims.sub, payload.newEpoch, payload.commit]
      );

      await client.query(
        `UPDATE mls_groups
            SET current_epoch = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [payload.newEpoch, groupId]
      );

      await client.query('COMMIT');
      inTransaction = false;
    } catch (transactionError) {
      if (inTransaction) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw transactionError;
    } finally {
      client.release();
    }

    const userResult = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [payload.userId]
    );

    const member: MlsGroupMember = {
      userId: payload.userId,
      email: userResult.rows[0]?.email ?? '',
      leafIndex,
      role: 'member',
      joinedAt: now.toISOString(),
      joinedAtEpoch: payload.newEpoch
    };

    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:member_added',
      payload: { groupId, member },
      timestamp: now.toISOString()
    });

    await broadcast(`mls:user:${payload.userId}`, {
      type: 'mls:welcome',
      payload: { groupId, welcomeId },
      timestamp: now.toISOString()
    });

    const response: AddMlsMemberResponse = { member };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to add member:', error);
    throw new ConnectError('Failed to add member', Code.Internal);
  }
}

export async function getGroupMembersDirect(
  request: GroupIdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/members`,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      throw new ConnectError(
        'Not a member of this group',
        Code.PermissionDenied
      );
    }

    const result = await pool.query<{
      user_id: string;
      email: string;
      leaf_index: number | null;
      role: string;
      joined_at: Date | string;
      joined_at_epoch: number;
    }>(
      `SELECT m.user_id, u.email, m.leaf_index, m.role, m.joined_at, m.joined_at_epoch
       FROM mls_group_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.group_id = $1 AND m.removed_at IS NULL
       ORDER BY m.joined_at ASC`,
      [groupId]
    );

    const members: MlsGroupMember[] = result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      leafIndex: row.leaf_index,
      role: row.role as 'admin' | 'member',
      joinedAt: toIsoString(row.joined_at),
      joinedAtEpoch: row.joined_at_epoch
    }));

    const response: MlsGroupMembersResponse = { members };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to list members:', error);
    throw new ConnectError('Failed to list members', Code.Internal);
  }
}

export async function removeGroupMemberDirect(
  request: RemoveMemberRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const groupId = request.groupId.trim();
  const userId = request.userId.trim();

  if (groupId.length === 0 || userId.length === 0) {
    throw new ConnectError(
      'groupId and userId are required',
      Code.InvalidArgument
    );
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/members/${encoded(userId)}`,
    context.requestHeader
  );

  const payload = parseRemoveMemberPayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError(
      'Invalid remove member payload',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      throw new ConnectError(
        'Not a member of this group',
        Code.PermissionDenied
      );
    }

    if (membership.role !== 'admin') {
      throw new ConnectError(
        'Only admins can remove members',
        Code.PermissionDenied
      );
    }

    const client = await pool.connect();
    let inTransaction = false;

    try {
      await client.query('BEGIN');
      inTransaction = true;

      const epochResult = await client.query<{ current_epoch: number }>(
        `SELECT current_epoch
           FROM mls_groups
          WHERE id = $1
          FOR UPDATE`,
        [groupId]
      );
      const currentEpoch = epochResult.rows[0]?.current_epoch;
      if (typeof currentEpoch !== 'number') {
        throw new ConnectError('Group not found', Code.NotFound);
      }

      const expectedEpoch = currentEpoch + 1;
      if (payload.newEpoch !== expectedEpoch) {
        throw new ConnectError('Epoch mismatch', Code.AlreadyExists);
      }

      const result = await client.query(
        `UPDATE mls_group_members
            SET removed_at = NOW()
          WHERE group_id = $1
            AND user_id = $2
            AND removed_at IS NULL`,
        [groupId, userId]
      );
      if (result.rowCount === 0) {
        throw new ConnectError('Member not found', Code.NotFound);
      }

      const commitId = randomUUID();
      await client.query(
        `INSERT INTO mls_messages (
           id,
           group_id,
           sender_user_id,
           epoch,
           ciphertext,
           message_type,
           sequence_number,
           created_at
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           'commit',
           COALESCE((SELECT MAX(sequence_number) FROM mls_messages WHERE group_id = $2), 0) + 1,
           NOW()
         )`,
        [commitId, groupId, claims.sub, payload.newEpoch, payload.commit]
      );

      await client.query(
        `UPDATE mls_groups
            SET current_epoch = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [payload.newEpoch, groupId]
      );

      await client.query('COMMIT');
      inTransaction = false;
    } catch (transactionError) {
      if (inTransaction) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw transactionError;
    } finally {
      client.release();
    }

    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:member_removed',
      payload: { groupId, userId },
      timestamp: new Date().toISOString()
    });

    return { json: '{}' };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to remove member:', error);
    throw new ConnectError('Failed to remove member', Code.Internal);
  }
}
