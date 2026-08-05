import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizationBillingSeatAssignments } from "@tearleads/api-shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { organizationCanSync } from "../../billing/organizationBilling";
import { resolveOrganizationBilling } from "./organizationBillingState";

export class OrganizationSyncDisabledError extends Error {
  readonly status = 402 as const;

  constructor(
    readonly organizationId: string,
    readonly reason: "billing_inactive" | "sync_seat_unassigned",
  ) {
    super(
      reason === "sync_seat_unassigned"
        ? "No sync seat is assigned to this user"
        : "Organization sync is not active",
    );
    this.name = "OrganizationSyncDisabledError";
  }
}

/** Guards a sync write by both organization entitlement and user assignment. */
export async function assertOrganizationCanSync(
  executor: DatabaseSession,
  organizationId: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const billing = await resolveOrganizationBilling(
    executor,
    organizationId,
    now,
  );
  if (!organizationCanSync(billing, now)) {
    throw new OrganizationSyncDisabledError(organizationId, "billing_inactive");
  }
  const [assignment] = await executor
    .select({ id: organizationBillingSeatAssignments.id })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(organizationBillingSeatAssignments.organizationId, organizationId),
        eq(organizationBillingSeatAssignments.userId, userId),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    )
    .limit(1);
  if (!assignment) {
    throw new OrganizationSyncDisabledError(
      organizationId,
      "sync_seat_unassigned",
    );
  }
}
