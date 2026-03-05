import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  CreateMlsGroupRequest,
  CreateMlsGroupResponse,
  MlsGroup,
  MlsGroupMember,
  MlsGroupResponse,
  MlsGroupsResponse,
  UpdateMlsGroupRequest
} from '@tearleads/shared';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { requireMlsClaims } from './mlsDirectAuth.js';
import {
  encoded,
  parseJsonBody,
  toIsoString,
  toMlsGroupRole
} from './mlsDirectCommon.js';
import {
  getActiveMlsGroupMembership,
  parseCreateGroupPayload,
  parseUpdateGroupPayload,
  toSafeCipherSuite
} from './mlsDirectShared.js';

type GroupIdRequest = { groupId: string };
type CreateGroupJsonRequest = { json: string };
type GroupIdJsonRequest = { groupId: string; json: string };
type GroupIdTypedUpdateRequest = { groupId: string } & UpdateMlsGroupRequest;

export async function createGroupDirectTyped(
  request: CreateMlsGroupRequest,
  context: { requestHeader: Headers }
): Promise<CreateMlsGroupResponse> {
  const claims = await requireMlsClaims('/mls/groups', context.requestHeader);
  const payload = parseCreateGroupPayload(request);
  if (!payload) {
    throw new ConnectError('Invalid group payload', Code.InvalidArgument);
  }
  try {
    const pool = await getPostgresPool();
    const id = randomUUID();
    const now = new Date();
    const organizationResult = await pool.query<{
      personal_organization_id: string;
    }>(
      `SELECT personal_organization_id
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [claims.sub]
    );
    const organizationId = organizationResult.rows[0]?.personal_organization_id;
    if (!organizationId) {
      throw new ConnectError(
        'No organization found for user',
        Code.PermissionDenied
      );
    }

    const client = await pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query(
        `INSERT INTO mls_groups (
           id,
           organization_id,
           group_id_mls,
           name,
           description,
           creator_user_id,
           current_epoch,
           cipher_suite,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $8)`,
        [
          id,
          organizationId,
          payload.groupIdMls,
          payload.name,
          payload.description ?? null,
          claims.sub,
          payload.cipherSuite,
          now
        ]
      );

      await client.query(
        `INSERT INTO mls_group_members (
           group_id,
           user_id,
           leaf_index,
           role,
           joined_at,
           joined_at_epoch
         ) VALUES ($1, $2, 0, 'admin', $3, 0)`,
        [id, claims.sub, now]
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
    const group: MlsGroup = {
      id,
      groupIdMls: payload.groupIdMls,
      name: payload.name,
      description: payload.description ?? null,
      creatorUserId: claims.sub,
      currentEpoch: 0,
      cipherSuite: payload.cipherSuite,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      memberCount: 1,
      role: 'admin'
    };

    return { group };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to create group:', error);
    throw new ConnectError('Failed to create group', Code.Internal);
  }
}

export async function createGroupDirect(
  request: CreateGroupJsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const payload = parseCreateGroupPayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError('Invalid group payload', Code.InvalidArgument);
  }
  const response = await createGroupDirectTyped(payload, context);
  return { json: JSON.stringify(response) };
}

export async function listGroupsDirectTyped(
  _request: object,
  context: { requestHeader: Headers }
): Promise<MlsGroupsResponse> {
  const claims = await requireMlsClaims('/mls/groups', context.requestHeader);
  try {
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      group_id_mls: string;
      name: string;
      description: string | null;
      creator_user_id: string;
      current_epoch: number;
      cipher_suite: number;
      created_at: Date | string;
      updated_at: Date | string;
      role: string;
      member_count: string;
    }>(
      `SELECT g.id, g.group_id_mls, g.name, g.description, g.creator_user_id,
              g.current_epoch, g.cipher_suite, g.created_at, g.updated_at,
              m.role,
              (SELECT COUNT(*) FROM mls_group_members WHERE group_id = g.id AND removed_at IS NULL)::text as member_count
       FROM mls_groups g
       JOIN mls_group_members m ON g.id = m.group_id
       JOIN user_organizations uo
         ON uo.user_id = m.user_id
        AND uo.organization_id = g.organization_id
       WHERE m.user_id = $1 AND m.removed_at IS NULL
       ORDER BY g.updated_at DESC`,
      [claims.sub]
    );

    const groups: MlsGroup[] = result.rows.map((row) => ({
      id: row.id,
      groupIdMls: row.group_id_mls,
      name: row.name,
      description: row.description,
      creatorUserId: row.creator_user_id,
      currentEpoch: row.current_epoch,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
      memberCount: parseInt(row.member_count, 10),
      role: toMlsGroupRole(row.role)
    }));

    return { groups };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to list groups:', error);
    throw new ConnectError('Failed to list groups', Code.Internal);
  }
}

export async function listGroupsDirect(
  request: object,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const response = await listGroupsDirectTyped(request, context);
  return { json: JSON.stringify(response) };
}

export async function getGroupDirectTyped(
  request: GroupIdRequest,
  context: { requestHeader: Headers }
): Promise<MlsGroupResponse> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}`,
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

    const groupResult = await pool.query<{
      id: string;
      group_id_mls: string;
      name: string;
      description: string | null;
      creator_user_id: string;
      current_epoch: number;
      cipher_suite: number;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT id, group_id_mls, name, description, creator_user_id,
              current_epoch, cipher_suite, created_at, updated_at
         FROM mls_groups
        WHERE id = $1`,
      [groupId]
    );

    const groupRow = groupResult.rows[0];
    if (!groupRow) {
      throw new ConnectError('Group not found', Code.NotFound);
    }

    const membersResult = await pool.query<{
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

    const group: MlsGroup = {
      id: groupRow.id,
      groupIdMls: groupRow.group_id_mls,
      name: groupRow.name,
      description: groupRow.description,
      creatorUserId: groupRow.creator_user_id,
      currentEpoch: groupRow.current_epoch,
      cipherSuite: toSafeCipherSuite(groupRow.cipher_suite),
      createdAt: toIsoString(groupRow.created_at),
      updatedAt: toIsoString(groupRow.updated_at)
    };

    const members: MlsGroupMember[] = membersResult.rows.map((memberRow) => ({
      userId: memberRow.user_id,
      email: memberRow.email,
      leafIndex: memberRow.leaf_index,
      role: toMlsGroupRole(memberRow.role),
      joinedAt: toIsoString(memberRow.joined_at),
      joinedAtEpoch: memberRow.joined_at_epoch
    }));

    return { group, members };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get group:', error);
    throw new ConnectError('Failed to get group', Code.Internal);
  }
}

export async function getGroupDirect(
  request: GroupIdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const response = await getGroupDirectTyped(request, context);
  return { json: JSON.stringify(response) };
}

export async function updateGroupDirectTyped(
  request: GroupIdTypedUpdateRequest,
  context: { requestHeader: Headers }
): Promise<CreateMlsGroupResponse> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}`,
    context.requestHeader
  );

  const payload = parseUpdateGroupPayload(request);
  if (!payload) {
    throw new ConnectError(
      'At least one field to update is required',
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
        'Only admins can update group',
        Code.PermissionDenied
      );
    }

    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (payload.name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      values.push(payload.name);
      paramIndex += 1;
    }

    if (payload.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(payload.description);
      paramIndex += 1;
    }

    values.push(groupId);

    const result = await pool.query<{
      id: string;
      group_id_mls: string;
      name: string;
      description: string | null;
      creator_user_id: string;
      current_epoch: number;
      cipher_suite: number;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `UPDATE mls_groups
          SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, group_id_mls, name, description, creator_user_id,
                  current_epoch, cipher_suite, created_at, updated_at`,
      values
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Group not found', Code.NotFound);
    }

    const group: MlsGroup = {
      id: row.id,
      groupIdMls: row.group_id_mls,
      name: row.name,
      description: row.description,
      creatorUserId: row.creator_user_id,
      currentEpoch: row.current_epoch,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at)
    };

    return { group };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to update group:', error);
    throw new ConnectError('Failed to update group', Code.Internal);
  }
}

export async function updateGroupDirect(
  request: GroupIdJsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const payload = parseUpdateGroupPayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError(
      'At least one field to update is required',
      Code.InvalidArgument
    );
  }
  const response = await updateGroupDirectTyped(
    { groupId: request.groupId, ...payload },
    context
  );
  return { json: JSON.stringify(response) };
}

export async function deleteGroupDirectTyped(
  request: GroupIdRequest,
  context: { requestHeader: Headers }
): Promise<Record<string, never>> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}`,
    context.requestHeader
  );

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      throw new ConnectError(
        'Not a member of this group',
        Code.PermissionDenied
      );
    }

    await pool.query(
      `UPDATE mls_group_members
          SET removed_at = NOW()
        WHERE group_id = $1
          AND user_id = $2`,
      [groupId, claims.sub]
    );

    return {};
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to leave group:', error);
    throw new ConnectError('Failed to leave group', Code.Internal);
  }
}

export async function deleteGroupDirect(
  request: GroupIdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  await deleteGroupDirectTyped(request, context);
  return { json: '{}' };
}
