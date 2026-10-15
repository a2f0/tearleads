import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizationBillingSeatAssignments } from "@tearleads/api-shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { organizationCanSync } from "../../billing/organizationBilling";
import {
  type OrganizationBillingRow,
  resolveOrganizationBilling,
} from "./organizationBillingState";

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

function assertBillingSyncEntitled(
  billing: OrganizationBillingRow,
  organizationId: string,
  now: Date,
): void {
  if (!organizationCanSync(billing, now)) {
    throw new OrganizationSyncDisabledError(organizationId, "billing_inactive");
  }
}

function assertBillingEndpointAvailable(
  billing: OrganizationBillingRow,
  organizationId: string,
): void {
  if (billing.status === "deleting" || billing.status === "purged") {
    throw new OrganizationSyncDisabledError(organizationId, "billing_inactive");
  }
}

async function assertSyncSeatAssigned(
  executor: DatabaseSession,
  organizationId: string,
  userId: string,
): Promise<void> {
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

/** Guards a sync write by both organization entitlement and user assignment. */
export async function assertOrganizationIsSyncEntitled(
  executor: DatabaseSession,
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  assertBillingSyncEntitled(
    await resolveOrganizationBilling(executor, organizationId, now),
    organizationId,
    now,
  );
}

/** Rejects every sync operation once destructive organization purge starts. */
export async function assertOrganizationSyncEndpointAvailable(
  executor: DatabaseSession,
  organizationId: string,
): Promise<void> {
  assertBillingEndpointAvailable(
    await resolveOrganizationBilling(executor, organizationId),
    organizationId,
  );
}

/** Guards a content sync write by entitlement and the caller's stable seat. */
export async function assertOrganizationCanSync(
  executor: DatabaseSession,
  organizationId: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await assertOrganizationIsSyncEntitled(executor, organizationId, now);
  await assertSyncSeatAssigned(executor, organizationId, userId);
}

/**
 * Document sync's billing guards over one billing read: every sync needs the
 * endpoint available, and a writing sync also needs entitlement and a seat.
 */
export async function assertDocumentSyncBillingAllowed(
  executor: DatabaseSession,
  input: {
    readonly organizationId: string;
    readonly requireWriteEntitlement: boolean;
    readonly userId: string;
  },
  now: Date = new Date(),
): Promise<void> {
  const billing = await resolveOrganizationBilling(
    executor,
    input.organizationId,
    now,
  );
  assertBillingEndpointAvailable(billing, input.organizationId);
  if (!input.requireWriteEntitlement) return;
  assertBillingSyncEntitled(billing, input.organizationId, now);
  await assertSyncSeatAssigned(executor, input.organizationId, input.userId);
}
