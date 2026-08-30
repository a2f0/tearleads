import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { organizationBillingSeatAssignments } from "@symcrypt/api-shared/schema";
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
export async function assertOrganizationIsSyncEntitled(
  executor: DatabaseSession,
  organizationId: string,
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
}

/** Rejects every sync operation once destructive organization purge starts. */
export async function assertOrganizationSyncEndpointAvailable(
  executor: DatabaseSession,
  organizationId: string,
): Promise<void> {
  const billing = await resolveOrganizationBilling(executor, organizationId);
  if (billing.status === "deleting" || billing.status === "purged") {
    throw new OrganizationSyncDisabledError(organizationId, "billing_inactive");
  }
}

/** Guards a content sync write by entitlement and the caller's stable seat. */
export async function assertOrganizationCanSync(
  executor: DatabaseSession,
  organizationId: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await assertOrganizationIsSyncEntitled(executor, organizationId, now);
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
