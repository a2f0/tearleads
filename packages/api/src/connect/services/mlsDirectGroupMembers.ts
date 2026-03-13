import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  AddMlsMemberBinaryRequest,
  AddMlsMemberBinaryResponse,
  MlsBinaryGroupMember,
  MlsBinaryGroupMembersResponse,
  MlsBinaryMessage,
  RemoveMlsMemberBinaryRequest
} from './mlsBinaryTypes.js';
import { broadcast } from '../../lib/broadcast.js';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { requireMlsClaims } from './mlsDirectAuth.js';
import { toTransportMessage } from './mlsBinaryTypes.js';
import { encodeBytesToBase64 } from './mlsBinaryCodec.js';
import { insertCommitMessage } from './mlsDirectCommitMessages.js';
import { encoded, toIsoString, toMlsGroupRole } from './mlsDirectCommon.js';
import { getActiveMlsGroupMembership } from './mlsDirectShared.js';

type GroupIdRequest = { groupId: string };
type AddMemberTypedRequest = { groupId: string } & AddMlsMemberBinaryRequest;
type RemoveMemberTypedRequest = {
  groupId: string;
  userId: string;
} & RemoveMlsMemberBinaryRequest;
export async function addGroupMemberDirectTyped(
  request: AddMemberTypedRequest,
  context: { requestHeader: Headers }
): Promise<AddMlsMemberBinaryResponse> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }
  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/members`,
    context.requestHeader
  );
  const payload: AddMlsMemberBinaryRequest = {
    userId: request.userId.trim(),
    commit: Uint8Array.from(request.commit),
    welcome: Uint8Array.from(request.welcome),
    keyPackageRef: request.keyPackageRef.trim(),
    newEpoch: request.newEpoch
  };
  if (
    payload.userId.length === 0 ||
    payload.commit.byteLength === 0 ||
    payload.welcome.byteLength === 0 ||
    payload.keyPackageRef.length === 0 ||
    !Number.isInteger(payload.newEpoch) ||
    payload.newEpoch < 0
  ) {
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
    let commitMessage: MlsBinaryMessage | null = null;
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
          encodeBytesToBase64(payload.welcome),
          payload.newEpoch
        ]
      );
      const commitId = randomUUID();
      commitMessage = await insertCommitMessage({
        client,
        commitId,
        groupId,
        organizationId: membership.organizationId,
        senderUserId: claims.sub,
        epoch: payload.newEpoch,
        commitCiphertext: payload.commit
      });
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
    if (!commitMessage) {
      throw new ConnectError('Failed to persist commit message', Code.Internal);
    }
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:message',
      payload: toTransportMessage(commitMessage, encodeBytesToBase64),
      timestamp: commitMessage.createdAt
    });
    const userResult = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [payload.userId]
    );
    const member: MlsBinaryGroupMember = {
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
    return { member };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to add member:', error);
    throw new ConnectError('Failed to add member', Code.Internal);
  }
}
export async function getGroupMembersDirectTyped(
  request: GroupIdRequest,
  context: { requestHeader: Headers }
): Promise<MlsBinaryGroupMembersResponse> {
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
    const members: MlsBinaryGroupMember[] = result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      leafIndex: row.leaf_index,
      role: toMlsGroupRole(row.role),
      joinedAt: toIsoString(row.joined_at),
      joinedAtEpoch: row.joined_at_epoch
    }));
    return { members };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to list members:', error);
    throw new ConnectError('Failed to list members', Code.Internal);
  }
}
export async function removeGroupMemberDirectTyped(
  request: RemoveMemberTypedRequest,
  context: { requestHeader: Headers }
): Promise<Record<string, never>> {
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
  const payload: RemoveMlsMemberBinaryRequest = {
    commit: Uint8Array.from(request.commit),
    newEpoch: request.newEpoch
  };
  if (
    payload.commit.byteLength === 0 ||
    !Number.isInteger(payload.newEpoch) ||
    payload.newEpoch < 0
  ) {
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
    let commitMessage: MlsBinaryMessage | null = null;
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
      commitMessage = await insertCommitMessage({
        client,
        commitId,
        groupId,
        organizationId: membership.organizationId,
        senderUserId: claims.sub,
        epoch: payload.newEpoch,
        commitCiphertext: payload.commit
      });
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
    if (!commitMessage) {
      throw new ConnectError('Failed to persist commit message', Code.Internal);
    }
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:message',
      payload: toTransportMessage(commitMessage, encodeBytesToBase64),
      timestamp: commitMessage.createdAt
    });
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:member_removed',
      payload: { groupId, userId },
      timestamp: commitMessage.createdAt
    });
    return {};
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to remove member:', error);
    throw new ConnectError('Failed to remove member', Code.Internal);
  }
}
