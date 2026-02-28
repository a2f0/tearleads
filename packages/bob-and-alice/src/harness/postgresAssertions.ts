import type { Pool as PgPool } from 'pg';
import { expect } from 'vitest';

interface AssertPgUserOrganizationMembershipInput {
  pool: PgPool;
  userId: string;
  organizationId: string;
}

export async function assertPgUserOrganizationMembership(
  input: AssertPgUserOrganizationMembershipInput
): Promise<void> {
  const result = await input.pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM user_organizations
     WHERE user_id = $1
       AND organization_id = $2`,
    [input.userId, input.organizationId]
  );
  const count = Number(result.rows[0]?.count ?? '0');
  expect(count).toBeGreaterThan(0);
}

interface AssertPgHasVfsRegistryItemInput {
  pool: PgPool;
  itemId: string;
  objectType: string;
}

export async function assertPgHasVfsRegistryItem(
  input: AssertPgHasVfsRegistryItemInput
): Promise<void> {
  const result = await input.pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM vfs_registry
     WHERE id = $1
       AND object_type = $2`,
    [input.itemId, input.objectType]
  );
  const count = Number(result.rows[0]?.count ?? '0');
  expect(count).toBe(1);
}

interface AssertPgHasActiveUserShareInput {
  pool: PgPool;
  itemId: string;
  targetUserId: string;
  grantedByUserId: string;
}

export async function assertPgHasActiveUserShare(
  input: AssertPgHasActiveUserShareInput
): Promise<void> {
  const result = await input.pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM vfs_acl_entries
     WHERE item_id = $1
       AND principal_type = 'user'
       AND principal_id = $2
       AND granted_by = $3
       AND revoked_at IS NULL`,
    [input.itemId, input.targetUserId, input.grantedByUserId]
  );
  const count = Number(result.rows[0]?.count ?? '0');
  expect(count).toBe(1);
}
