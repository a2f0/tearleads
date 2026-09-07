import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizationRosterEntries, users } from "@tearleads/api-shared/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import {
  rootIdentitySelection,
  toRootIdentitySummary,
} from "./identitySummary";

export async function listRootOrganizationIdentities(
  executor: DatabaseSession,
  organizationId: string,
  input: { afterId?: string | undefined; limit: number },
) {
  const rows = await executor
    .select({
      ...rootIdentitySelection,
      rosterStatus: organizationRosterEntries.status,
      rosterJoinedAt: organizationRosterEntries.joinedAt,
      rosterDisabledAt: organizationRosterEntries.disabledAt,
    })
    .from(organizationRosterEntries)
    .innerJoin(users, eq(users.id, organizationRosterEntries.userId))
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        input.afterId === undefined ? undefined : gt(users.id, input.afterId),
      ),
    )
    .orderBy(asc(users.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  return {
    identities: page.map((row) => ({
      identity: toRootIdentitySummary(row),
      roster: {
        status: row.rosterStatus,
        joinedAt: row.rosterJoinedAt.toISOString(),
        disabledAt: row.rosterDisabledAt?.toISOString() ?? null,
      },
    })),
    nextAfterId:
      rows.length > input.limit ? (page.at(-1)?.userId ?? null) : null,
  };
}
