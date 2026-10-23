import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizationBillingSeatAssignments } from "@tearleads/api-shared/schema";
import { and, inArray, isNull } from "drizzle-orm";

export function seatHolderKey(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}

/**
 * The (organization, user) pairs among the given ids that hold an unreleased
 * seat assignment, keyed by `seatHolderKey`. Holding a seat is what billing
 * itself checks; the lookup leads with organization and user ids, so the
 * `org_user` assignment index serves it. A pair can hold assignments in more
 * than one billing period; the set collapses them.
 */
export async function loadOpenSeatHolders(
  executor: DatabaseSession,
  input: {
    readonly organizationIds: readonly string[];
    readonly userIds: readonly string[];
  },
): Promise<ReadonlySet<string>> {
  if (input.organizationIds.length === 0 || input.userIds.length === 0) {
    return new Set();
  }
  const rows = await executor
    .select({
      organizationId: organizationBillingSeatAssignments.organizationId,
      userId: organizationBillingSeatAssignments.userId,
    })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        inArray(organizationBillingSeatAssignments.organizationId, [
          ...input.organizationIds,
        ]),
        inArray(organizationBillingSeatAssignments.userId, [...input.userIds]),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  return new Set(
    rows.map((row) => seatHolderKey(row.organizationId, row.userId)),
  );
}
