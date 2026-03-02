import { Code, ConnectError } from '@connectrpc/connect';
import type {
  GroupDetailResponse,
  GroupMembersResponse,
  GroupsListResponse,
  GroupWithMemberCount
} from '@tearleads/shared';
import { getPool } from '../../lib/postgres.js';
import {
  type GroupMemberRow,
  type GroupRow,
  getGroupOrganizationId,
  mapGroupMemberRow,
  mapGroupRow
} from '../../routes/admin/groups/shared.js';
import {
  requireScopedAdminAccess,
  type ScopedAdminAccess
} from './adminDirectAuth.js';

type ListGroupsRequest = { organizationId: string };
type IdRequest = { id: string };

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

function normalizeOrganizationId(organizationId: string): string | null {
  const trimmed = organizationId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function listGroupsDirect(
  request: ListGroupsRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    '/admin/groups',
    context.requestHeader
  );
  const requestedOrganizationId = normalizeOrganizationId(
    request.organizationId
  );
  if (
    requestedOrganizationId !== null &&
    !canAccessOrganization(authorization, requestedOrganizationId)
  ) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }

  try {
    const pool = await getPool('read');
    type GroupsListRow = {
      id: string;
      organization_id: string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
      member_count: string;
    };

    let result: { rows: GroupsListRow[] };
    if (
      authorization.adminAccess.isRootAdmin &&
      requestedOrganizationId === null
    ) {
      result = await pool.query<GroupsListRow>(`
        SELECT
          g.id,
          g.organization_id,
          g.name,
          g.description,
          g.created_at,
          g.updated_at,
          COUNT(ug.user_id)::text AS member_count
        FROM groups g
        LEFT JOIN user_groups ug ON ug.group_id = g.id
        GROUP BY g.id
        ORDER BY g.name
      `);
    } else {
      const scopedOrganizationIds =
        requestedOrganizationId !== null
          ? [requestedOrganizationId]
          : authorization.adminAccess.organizationIds;
      result = await pool.query<GroupsListRow>(
        `SELECT
           g.id,
           g.organization_id,
           g.name,
           g.description,
           g.created_at,
           g.updated_at,
           COUNT(ug.user_id)::text AS member_count
         FROM groups g
         LEFT JOIN user_groups ug ON ug.group_id = g.id
         WHERE g.organization_id = ANY($1::text[])
         GROUP BY g.id
         ORDER BY g.name`,
        [scopedOrganizationIds]
      );
    }

    const groups: GroupWithMemberCount[] = result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      memberCount: parseInt(row.member_count, 10)
    }));
    const response: GroupsListResponse = { groups };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Groups error:', error);
    throw new ConnectError('Failed to fetch groups', Code.Internal);
  }
}

export async function getGroupDirect(
  request: IdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/groups/${encoded(request.id)}`,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const groupResult = await pool.query<GroupRow>(
      'SELECT id, organization_id, name, description, created_at, updated_at FROM groups WHERE id = $1',
      [request.id]
    );

    const groupRow = groupResult.rows[0];
    if (!groupRow) {
      throw new ConnectError('Group not found', Code.NotFound);
    }
    if (!canAccessOrganization(authorization, groupRow.organization_id)) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const membersResult = await pool.query<GroupMemberRow>(
      `SELECT ug.user_id, u.email, ug.joined_at
       FROM user_groups ug
       JOIN users u ON u.id = ug.user_id
       WHERE ug.group_id = $1
       ORDER BY ug.joined_at`,
      [request.id]
    );

    const response: GroupDetailResponse = {
      group: mapGroupRow(groupRow),
      members: membersResult.rows.map(mapGroupMemberRow)
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Groups error:', error);
    throw new ConnectError('Failed to fetch group', Code.Internal);
  }
}

export async function getGroupMembersDirect(
  request: IdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/groups/${encoded(request.id)}/members`,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const organizationId = await getGroupOrganizationId(pool, request.id);
    if (!organizationId) {
      throw new ConnectError('Group not found', Code.NotFound);
    }
    if (!canAccessOrganization(authorization, organizationId)) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const membersResult = await pool.query<GroupMemberRow>(
      `SELECT ug.user_id, u.email, ug.joined_at
         FROM user_groups ug
         JOIN users u ON u.id = ug.user_id
         WHERE ug.group_id = $1
         ORDER BY ug.joined_at`,
      [request.id]
    );
    const response: GroupMembersResponse = {
      members: membersResult.rows.map(mapGroupMemberRow)
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Groups error:', error);
    throw new ConnectError('Failed to fetch members', Code.Internal);
  }
}
