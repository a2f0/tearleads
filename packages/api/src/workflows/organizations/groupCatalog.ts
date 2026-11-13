import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { and, asc, eq, ne } from "drizzle-orm";
import { getCurrentPrincipalStates } from "../../access/read/principalStateStore";

/** Display-only catalog shared by the two snapshot lanes, never authorization. */
export async function loadOrganizationGroupCatalog(
  executor: DatabaseSession,
  organizationId: string,
  excludedGroupId?: string,
) {
  const groupRows = await executor
    .select({
      groupId: groups.id,
      organizationId: groups.organizationId,
      createdAt: groups.createdAt,
    })
    .from(groups)
    .where(
      and(
        eq(groups.organizationId, organizationId),
        excludedGroupId ? ne(groups.id, excludedGroupId) : undefined,
      ),
    )
    .orderBy(asc(groups.id));
  const currentStates = await getCurrentPrincipalStates(
    "group",
    groupRows.map((group) => group.groupId),
    executor,
  );
  return { groupRows, currentStates };
}

export type OrganizationGroupCatalog = Awaited<
  ReturnType<typeof loadOrganizationGroupCatalog>
>;
