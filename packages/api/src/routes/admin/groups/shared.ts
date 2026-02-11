import type { Group, GroupMember } from '@rapid/shared';
import type { Pool } from 'pg';

export type GroupRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

export type GroupMemberRow = {
  user_id: string;
  email: string;
  joined_at: Date;
};

export function mapGroupRow(row: GroupRow): Group {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export function mapGroupMemberRow(row: GroupMemberRow): GroupMember {
  return {
    userId: row.user_id,
    email: row.email,
    joinedAt: row.joined_at.toISOString()
  };
}

export async function getGroupOrganizationId(
  pool: Pool,
  groupId: string
): Promise<string | null> {
  const groupResult = await pool.query<{ organization_id: string }>(
    'SELECT organization_id FROM groups WHERE id = $1',
    [groupId]
  );
  return groupResult.rows[0]?.organization_id ?? null;
}
