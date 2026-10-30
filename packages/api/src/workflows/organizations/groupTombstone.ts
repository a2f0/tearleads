import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationGroupTombstones,
} from "@tearleads/api-shared/schema";
import { eq, sql } from "drizzle-orm";

export async function wasOrganizationGroupDeleted(input: {
  readonly executor: DatabaseSession;
  readonly groupId: string;
}): Promise<boolean> {
  const [deleted] = await input.executor
    .select({ groupId: organizationGroupTombstones.groupId })
    .from(organizationGroupTombstones)
    .where(eq(organizationGroupTombstones.groupId, input.groupId))
    .limit(1);
  return deleted !== undefined;
}

/**
 * A group's tombstone and its live row in one statement. A tombstoned group is
 * reported deleted even when no `groups` row remains; otherwise the live row's
 * organization (null for a standalone group or a missing row).
 */
export async function readOrganizationGroupLiveness(input: {
  readonly executor: DatabaseSession;
  readonly groupId: string;
}): Promise<
  | { readonly deleted: true }
  | { readonly deleted: false; readonly organizationId: string | null }
> {
  const rows = await input.executor
    .select({
      deleted: sql<number>`1`,
      organizationId: sql<string | null>`null`,
    })
    .from(organizationGroupTombstones)
    .where(eq(organizationGroupTombstones.groupId, input.groupId))
    .unionAll(
      input.executor
        .select({
          deleted: sql<number>`0`,
          organizationId: sql<string | null>`${groups.organizationId}`,
        })
        .from(groups)
        .where(eq(groups.id, input.groupId)),
    );
  if (rows.some((row) => Number(row.deleted) === 1)) return { deleted: true };
  return { deleted: false, organizationId: rows[0]?.organizationId ?? null };
}
