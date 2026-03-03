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

function getRequiredOrganizationId(organizationId: string): string {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (normalizedOrganizationId === null) {
    throw new ConnectError('Invalid group organization', Code.Internal);
  }
  return normalizedOrganizationId;
}

type GroupMemberCandidate = {
  user_id: string | null;
  email: string | null;
  joined_at: Date | null;
};

function toGroupMemberRows<T extends GroupMemberCandidate>(
  rows: T[]
): GroupMemberRow[] {
  return rows
    .filter(
      (row): row is T & { user_id: string; email: string; joined_at: Date } =>
        row.user_id !== null && row.email !== null && row.joined_at !== null
    )
    .map(({ user_id, email, joined_at }) => ({
      user_id,
      email,
      joined_at
    }));
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

    const isRootWithoutOrgFilter =
      authorization.adminAccess.isRootAdmin && requestedOrganizationId === null;
    const queryParts = [
      `SELECT
         g.id,
         g.organization_id,
         g.name,
         g.description,
         g.created_at,
         g.updated_at,
         COUNT(ug.user_id)::text AS member_count
       FROM groups g
       LEFT JOIN user_groups ug ON ug.group_id = g.id`
    ];
    const queryParams: unknown[] = [];

    if (!isRootWithoutOrgFilter) {
      const scopedOrganizationIds =
        requestedOrganizationId !== null
          ? [requestedOrganizationId]
          : authorization.adminAccess.organizationIds;
      queryParts.push('WHERE g.organization_id = ANY($1::text[])');
      queryParams.push(scopedOrganizationIds);
    }

    queryParts.push('GROUP BY g.id', 'ORDER BY g.name');
    const result = await pool.query<GroupsListRow>(
      queryParts.join('\n'),
      queryParams
    );

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
    type GroupWithMemberRow = GroupRow & {
      user_id: string | null;
      email: string | null;
      joined_at: Date | null;
    };

    const result = await pool.query<GroupWithMemberRow>(
      `SELECT
         g.id,
         g.organization_id,
         g.name,
         g.description,
         g.created_at,
         g.updated_at,
         ug.user_id,
         u.email,
         ug.joined_at
       FROM groups g
       LEFT JOIN user_groups ug ON ug.group_id = g.id
       LEFT JOIN users u ON u.id = ug.user_id
       WHERE g.id = $1
       ORDER BY ug.joined_at`,
      [request.id]
    );

    const groupRow = result.rows[0];
    if (!groupRow) {
      throw new ConnectError('Group not found', Code.NotFound);
    }
    const organizationId = getRequiredOrganizationId(groupRow.organization_id);
    if (!canAccessOrganization(authorization, organizationId)) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const members = toGroupMemberRows(result.rows);

    const response: GroupDetailResponse = {
      group: mapGroupRow(groupRow),
      members: members.map(mapGroupMemberRow)
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
    type GroupWithMemberRow = {
      organization_id: string;
      user_id: string | null;
      email: string | null;
      joined_at: Date | null;
    };

    const result = await pool.query<GroupWithMemberRow>(
      `SELECT g.organization_id, ug.user_id, u.email, ug.joined_at
         FROM groups g
         LEFT JOIN user_groups ug ON ug.group_id = g.id
         LEFT JOIN users u ON u.id = ug.user_id
         WHERE g.id = $1
         ORDER BY ug.joined_at`,
      [request.id]
    );

    const firstRow = result.rows[0];
    if (!firstRow) {
      throw new ConnectError('Group not found', Code.NotFound);
    }
    const organizationId = getRequiredOrganizationId(firstRow.organization_id);
    if (!canAccessOrganization(authorization, organizationId)) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    const members = toGroupMemberRows(result.rows);

    const response: GroupMembersResponse = {
      members: members.map(mapGroupMemberRow)
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
