import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type { CreateGroupRequest, UpdateGroupRequest } from '@tearleads/shared';
import type { Pool } from 'pg';
import { getPool } from '../../lib/postgres.js';
import {
  requireScopedAdminAccess,
  type ScopedAdminAccess
} from './adminDirectAuth.js';
import {
  type GroupRow,
  getGroupOrganizationId,
  mapGroupRow
} from './adminDirectGroupsShared.js';
import type { OptionalWithUndefined } from './adminDirectTypes.js';

type IdRequest = { id: string };
type CreateGroupInput = OptionalWithUndefined<CreateGroupRequest>;
type UpdateGroupInput = {
  id: string;
} & OptionalWithUndefined<UpdateGroupRequest>;
type AddGroupMemberInput = { id: string; userId: string };
type RemoveGroupMemberRequest = { groupId: string; userId: string };

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function canAccessOrganization(
  authorization: ScopedAdminAccess,
  organizationId: string
): boolean {
  return (
    authorization.adminAccess.isRootAdmin ||
    authorization.adminAccess.organizationIds.includes(organizationId)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDuplicateConstraintError(error: unknown): error is Error {
  if (!isRecord(error)) {
    return false;
  }
  const code = error['code'];
  return typeof code === 'string' && code === '23505';
}

async function ensureOrganizationExists(
  pool: Pool,
  organizationId: string
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM organizations WHERE id = $1',
    [organizationId]
  );
  if (result.rows.length === 0) {
    throw new ConnectError('Organization not found', Code.NotFound);
  }
}

export async function createGroupDirect(
  request: CreateGroupInput,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    '/admin/groups',
    context.requestHeader
  );
  const { name, description, organizationId } = request;

  if (typeof name !== 'string' || name.trim() === '') {
    throw new ConnectError('Name is required', Code.InvalidArgument);
  }
  if (typeof organizationId !== 'string' || organizationId.trim() === '') {
    throw new ConnectError('Organization ID is required', Code.InvalidArgument);
  }
  const trimmedOrganizationId = organizationId.trim();
  if (!canAccessOrganization(authorization, trimmedOrganizationId)) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }

  try {
    const pool = await getPool('write');
    await ensureOrganizationExists(pool, trimmedOrganizationId);

    const now = new Date();
    const result = await pool.query<GroupRow>(
      `INSERT INTO groups (id, organization_id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organization_id, name, description, created_at, updated_at`,
      [
        randomUUID(),
        trimmedOrganizationId,
        name.trim(),
        typeof description === 'string' ? description.trim() || null : null,
        now,
        now
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Failed to create group', Code.Internal);
    }

    return {
      json: JSON.stringify({
        group: mapGroupRow(row)
      })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Groups error:', error);
    if (isDuplicateConstraintError(error)) {
      throw new ConnectError('Group name already exists', Code.AlreadyExists);
    }
    throw new ConnectError('Failed to create group', Code.Internal);
  }
}

export async function updateGroupDirect(
  request: UpdateGroupInput,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const { id, ...payload } = request;
  const authorization = await requireScopedAdminAccess(
    `/admin/groups/${encoded(id)}`,
    context.requestHeader
  );
  const { name, description, organizationId } = payload;

  try {
    const pool = await getPool('write');
    const currentOrganizationId = await getGroupOrganizationId(pool, id);
    if (!currentOrganizationId) {
      throw new ConnectError('Group not found', Code.NotFound);
    }
    if (!canAccessOrganization(authorization, currentOrganizationId)) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const updates: string[] = [];
    const values: (string | Date | null)[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new ConnectError('Name cannot be empty', Code.InvalidArgument);
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(
        typeof description === 'string' ? description.trim() || null : null
      );
    }

    if (organizationId !== undefined) {
      if (typeof organizationId !== 'string' || organizationId.trim() === '') {
        throw new ConnectError(
          'Organization ID cannot be empty',
          Code.InvalidArgument
        );
      }
      const trimmedOrganizationId = organizationId.trim();
      await ensureOrganizationExists(pool, trimmedOrganizationId);
      if (!canAccessOrganization(authorization, trimmedOrganizationId)) {
        throw new ConnectError('Forbidden', Code.PermissionDenied);
      }
      updates.push(`organization_id = $${paramIndex++}`);
      values.push(trimmedOrganizationId);
    }

    if (updates.length === 0) {
      throw new ConnectError('No fields to update', Code.InvalidArgument);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());
    values.push(id);

    const result = await pool.query<GroupRow>(
      `UPDATE groups
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, organization_id, name, description, created_at, updated_at`,
      values
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Group not found', Code.NotFound);
    }

    return {
      json: JSON.stringify({
        group: mapGroupRow(row)
      })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Groups error:', error);
    if (isDuplicateConstraintError(error)) {
      throw new ConnectError('Group name already exists', Code.AlreadyExists);
    }
    throw new ConnectError('Failed to update group', Code.Internal);
  }
}

export async function deleteGroupDirect(
  request: IdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/groups/${encoded(request.id)}`,
    context.requestHeader
  );

  try {
    const pool = await getPool('write');
    const organizationId = await getGroupOrganizationId(pool, request.id);
    if (!organizationId) {
      throw new ConnectError('Group not found', Code.NotFound);
    }
    if (!canAccessOrganization(authorization, organizationId)) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const result = await pool.query('DELETE FROM groups WHERE id = $1', [
      request.id
    ]);
    return {
      json: JSON.stringify({
        deleted: result.rowCount !== null && result.rowCount > 0
      })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Groups error:', error);
    throw new ConnectError('Failed to delete group', Code.Internal);
  }
}

export async function addGroupMemberDirect(
  request: AddGroupMemberInput,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const { id, userId } = request;
  const authorization = await requireScopedAdminAccess(
    `/admin/groups/${encoded(id)}/members`,
    context.requestHeader
  );
  if (!userId || typeof userId !== 'string') {
    throw new ConnectError('userId is required', Code.InvalidArgument);
  }

  try {
    const pool = await getPool('write');
    const organizationId = await getGroupOrganizationId(pool, id);
    if (!organizationId) {
      throw new ConnectError('Group not found', Code.NotFound);
    }
    if (!canAccessOrganization(authorization, organizationId)) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const userExists = await pool.query('SELECT 1 FROM users WHERE id = $1', [
      userId
    ]);
    if (userExists.rowCount === 0) {
      throw new ConnectError('User not found', Code.NotFound);
    }

    const now = new Date();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, joined_at)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
        [userId, organizationId, now]
      );
      await client.query(
        `INSERT INTO user_groups (user_id, group_id, joined_at)
           VALUES ($1, $2, $3)`,
        [userId, id, now]
      );
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Groups rollback error:', rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }

    return {
      json: JSON.stringify({ added: true })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Groups error:', error);
    if (isDuplicateConstraintError(error)) {
      throw new ConnectError(
        'User is already a member of this group',
        Code.AlreadyExists
      );
    }
    throw new ConnectError('Failed to add member', Code.Internal);
  }
}

export async function removeGroupMemberDirect(
  request: RemoveGroupMemberRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/groups/${encoded(request.groupId)}/members/${encoded(request.userId)}`,
    context.requestHeader
  );

  try {
    const pool = await getPool('write');
    const organizationId = await getGroupOrganizationId(pool, request.groupId);
    if (!organizationId) {
      throw new ConnectError('Group not found', Code.NotFound);
    }
    if (!canAccessOrganization(authorization, organizationId)) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const result = await pool.query(
      'DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2',
      [request.groupId, request.userId]
    );
    return {
      json: JSON.stringify({
        removed: result.rowCount !== null && result.rowCount > 0
      })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Groups error:', error);
    throw new ConnectError('Failed to remove member', Code.Internal);
  }
}
