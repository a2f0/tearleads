import { strict as assert } from 'node:assert';

interface PgQueryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

interface AssertPgUserOrganizationMembershipInput {
  pool: PgQueryable;
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
  assert.ok(
    count > 0,
    `Expected membership for user ${input.userId} in organization ${input.organizationId}`
  );
}

interface AssertPgHasVfsRegistryItemInput {
  pool: PgQueryable;
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
  assert.equal(
    count,
    1,
    `Expected one vfs_registry row for item ${input.itemId} with object type ${input.objectType}`
  );
}

interface AssertPgHasActiveUserShareInput {
  pool: PgQueryable;
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
  assert.equal(
    count,
    1,
    `Expected one active user share for item ${input.itemId}`
  );
}
