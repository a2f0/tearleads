import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizationCanSync } from "../../billing/organizationBilling";
import {
  type OrganizationBillingRow,
  resolveOrganizationBilling,
  resolveOrganizationBillingWithSeat,
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

function assertSyncSeatAssigned(
  organizationId: string,
  assignment: string | null,
): void {
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
  const { billing, seatId } = await resolveOrganizationBillingWithSeat(
    executor,
    organizationId,
    userId,
    now,
  );
  assertBillingSyncEntitled(billing, organizationId, now);
  assertSyncSeatAssigned(organizationId, seatId);
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
  if (!input.requireWriteEntitlement) {
    assertBillingEndpointAvailable(
      await resolveOrganizationBilling(executor, input.organizationId, now),
      input.organizationId,
    );
    return;
  }
  const { billing, seatId } = await resolveOrganizationBillingWithSeat(
    executor,
    input.organizationId,
    input.userId,
    now,
  );
  assertBillingEndpointAvailable(billing, input.organizationId);
  assertBillingSyncEntitled(billing, input.organizationId, now);
  assertSyncSeatAssigned(input.organizationId, seatId);
}
