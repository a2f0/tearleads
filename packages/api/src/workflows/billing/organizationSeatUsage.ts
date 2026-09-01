import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizationBillingSeatAssignments } from "@tearleads/api-shared/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

interface OrganizationBillingSeatUsage {
  readonly assignedSeatCount: number;
  readonly assignedUserIds: readonly string[];
  readonly currentUserHasSyncSeat: boolean;
}

export async function loadOrganizationBillingSeatUsage(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly sessionUserId: string;
}): Promise<OrganizationBillingSeatUsage> {
  const assignments = await input.executor
    .select({
      assignedAt: organizationBillingSeatAssignments.assignedAt,
      userId: organizationBillingSeatAssignments.userId,
    })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(
          organizationBillingSeatAssignments.organizationId,
          input.organizationId,
        ),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    )
    .orderBy(
      asc(organizationBillingSeatAssignments.assignedAt),
      asc(organizationBillingSeatAssignments.userId),
    );
  const assignedUserIds = assignments.map(({ userId }) => userId);
  return {
    assignedSeatCount: assignedUserIds.length,
    assignedUserIds,
    currentUserHasSyncSeat: assignedUserIds.includes(input.sessionUserId),
  };
}
