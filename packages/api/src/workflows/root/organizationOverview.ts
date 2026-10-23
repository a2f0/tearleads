import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizationBillingSeatAssignments,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import type { RootOrganizationDetailResponse } from "@tearleads/validators/response";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";

type RootOrganizationOverview = RootOrganizationDetailResponse["overview"];

/**
 * Group bindings and roster and seat counts for one organization, or null
 * when it does not exist. Every count is scoped by organization id first, so
 * the roster `org_status` and assignment `org_open` indexes serve them.
 */
export async function loadRootOrganizationOverview(
  executor: DatabaseSession,
  organizationId: string,
): Promise<RootOrganizationOverview | null> {
  const [groups] = await executor
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!groups) return null;
  const statusCounts = await executor
    .select({ status: organizationRosterEntries.status, members: count() })
    .from(organizationRosterEntries)
    .where(eq(organizationRosterEntries.organizationId, organizationId))
    .groupBy(organizationRosterEntries.status);
  const [paused] = await executor
    .select({ members: count() })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.status, "active"),
        isNotNull(organizationRosterEntries.syncPausedAt),
      ),
    );
  const [seats] = await executor
    .select({ assignments: count() })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(organizationBillingSeatAssignments.organizationId, organizationId),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  const membersWith = (status: "active" | "disabled") =>
    statusCounts.find((row) => row.status === status)?.members ?? 0;
  return {
    ...groups,
    activeMemberCount: membersWith("active"),
    disabledMemberCount: membersWith("disabled"),
    syncPausedMemberCount: paused?.members ?? 0,
    openSeatAssignmentCount: seats?.assignments ?? 0,
  };
}
