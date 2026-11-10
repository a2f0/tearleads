import { randomUUID } from "node:crypto";
import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  BILLING_ERROR_CODES,
  getSyncBillingTierForNativeProduct,
  getSyncBillingTierForSeatCount,
  type SyncBillingTier,
} from "@tearleads/validators/billing";
import { eq } from "drizzle-orm";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import { OrganizationManagerError } from "../organizations/errors";
import { withOrganizationAdminTransaction } from "../organizations/mutationAccess";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";

/**
 * Plan changes for an organization's active Stripe subscription. The paid
 * capacity is `organization_billing.seat_count`; the Stripe seat outbox
 * (`organization_billing_stripe_seats`) carries the Price the subscription
 * renews at as `desired_renewal_quantity`, which the seat-sync worker
 * (services/billing/stripeSeatSync.ts) writes to Stripe without proration and
 * never above the paid capacity.
 *
 * - A smaller plan is scheduled: it only lowers the renewal quantity, so the
 *   current capacity stays until the renewal invoice, which Stripe charges at
 *   the smaller Price. No credit is given.
 * - Choosing the current plan keeps it, cancelling a scheduled change.
 * - A larger plan is an upgrade the service pays for in Stripe first. It
 *   leases the outbox row (so the worker cannot write the Price meanwhile)
 *   and records the larger renewal quantity before calling Stripe, so a crash
 *   after Stripe applied the upgrade never lets the worker undo it; capacity
 *   is granted only after the prorated charge succeeded.
 */

const PLAN_LEASE_PREFIX = "plan:";
const PLAN_LEASE_MS = 5 * 60 * 1_000;

type StripeSeatRow = typeof organizationBillingStripeSeats.$inferSelect;

export type BegunStripePlanChange =
  | { readonly kind: "kept" | "scheduled" }
  | {
      readonly kind: "upgrade";
      readonly leaseId: string;
      /** The capacity paid for this period, before the upgrade. */
      readonly paidCapacity: number;
      /** The renewal quantity to restore if the upgrade is not paid. */
      readonly previousRenewalQuantity: number;
      readonly subscriptionId: string;
      readonly subscriptionItemId: string;
    };

export function stripePlanChangeUnavailable(
  message: string,
): OrganizationManagerError {
  return new OrganizationManagerError(
    message,
    409,
    BILLING_ERROR_CODES.planChangeUnavailable,
  );
}

/** Locks the billing row, as every Stripe seat-row writer does first. */
async function lockActiveBilling(
  executor: DatabaseSession,
  organizationId: string,
) {
  const [billing] = await lockRowForUpdate(
    executor
      .select({
        providerProductId: organizationBilling.providerProductId,
        seatCount: organizationBilling.seatCount,
        status: organizationBilling.status,
      })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId))
      .limit(1),
  );
  if (billing?.status !== "active") {
    throw stripePlanChangeUnavailable(
      "The organization has no active subscription to change",
    );
  }
  return billing;
}

/** The outbox row; callers hold the billing row lock its writers take. */
async function readStripeSeats(
  executor: DatabaseSession,
  organizationId: string,
): Promise<StripeSeatRow | undefined> {
  const [seats] = await executor
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId))
    .limit(1);
  return seats;
}

function planChangeInFlight(seats: StripeSeatRow, now: Date): boolean {
  return (
    seats.leaseId?.startsWith(PLAN_LEASE_PREFIX) === true &&
    seats.leaseExpiresAt !== null &&
    seats.leaseExpiresAt > now
  );
}

async function requirePlanCoversRoster(
  executor: DatabaseSession,
  organizationId: string,
  plan: SyncBillingTier,
): Promise<void> {
  const [organization] = await executor
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const members = organization
    ? await listUsersReachableFromCurrentGroup({
        executor,
        groupId: organization.memberGroupId,
      })
    : [];
  if (plan.seatLimit < members.length) {
    throw stripePlanChangeUnavailable(
      "The plan does not cover the organization's members; remove members first",
    );
  }
}

type BoundStripeSeats = StripeSeatRow & {
  readonly subscriptionId: string;
  readonly subscriptionItemId: string;
};

async function requireChangeableSeats(
  executor: DatabaseSession,
  organizationId: string,
  now: Date,
): Promise<BoundStripeSeats> {
  const seats = await readStripeSeats(executor, organizationId);
  if (!seats?.subscriptionId || !seats.subscriptionItemId) {
    throw stripePlanChangeUnavailable(
      "The organization has no Stripe subscription to change",
    );
  }
  if (planChangeInFlight(seats, now)) {
    throw stripePlanChangeUnavailable(
      "Another plan change is still being applied",
    );
  }
  return {
    ...seats,
    subscriptionId: seats.subscriptionId,
    subscriptionItemId: seats.subscriptionItemId,
  };
}

/** Renews at `plan`, or keeps renewing at the current one. */
async function setRenewalPlan(
  executor: DatabaseSession,
  seats: StripeSeatRow,
  plan: SyncBillingTier,
  now: Date,
): Promise<void> {
  if (seats.desiredRenewalQuantity === plan.seatLimit) {
    return;
  }
  await executor
    .update(organizationBillingStripeSeats)
    .set({
      desiredRenewalQuantity: plan.seatLimit,
      desiredRevision: seats.desiredRevision + 1,
      nextAttemptAt: now,
      updatedAt: now,
    })
    .where(eq(organizationBillingStripeSeats.id, seats.id));
}

/** Leases the outbox row for an upgrade and records its renewal plan. */
async function leaseUpgrade(
  executor: DatabaseSession,
  seats: BoundStripeSeats,
  input: {
    readonly leaseId: string;
    readonly now: Date;
    readonly paidCapacity: number;
    readonly plan: SyncBillingTier;
  },
): Promise<BegunStripePlanChange> {
  const { now } = input;
  if (seats.leaseExpiresAt !== null && seats.leaseExpiresAt > now) {
    throw stripePlanChangeUnavailable(
      "The subscription is being updated; try again shortly",
    );
  }
  await executor
    .update(organizationBillingStripeSeats)
    .set({
      desiredRenewalQuantity: input.plan.seatLimit,
      desiredRevision: seats.desiredRevision + 1,
      leaseExpiresAt: new Date(now.getTime() + PLAN_LEASE_MS),
      leaseId: input.leaseId,
      updatedAt: now,
    })
    .where(eq(organizationBillingStripeSeats.id, seats.id));
  return {
    kind: "upgrade",
    leaseId: input.leaseId,
    paidCapacity: input.paidCapacity,
    previousRenewalQuantity: seats.desiredRenewalQuantity,
    subscriptionId: seats.subscriptionId,
    subscriptionItemId: seats.subscriptionItemId,
  };
}

/**
 * Starts changing the active Stripe subscription to `plan`. A smaller plan or
 * the current one is settled here; a larger one returns the upgrade the
 * service must pay for in Stripe while it holds the returned lease.
 */
export async function runBeginStripePlanChangeWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  options: {
    readonly createLeaseId?: () => string;
    readonly now?: Date;
    readonly plan: SyncBillingTier;
  },
): Promise<BegunStripePlanChange> {
  const now = options.now ?? new Date();
  const { plan } = options;
  return withOrganizationAdminTransaction(
    db,
    { organizationId, userId: sessionUserId },
    async (tx) => {
      const billing = await lockActiveBilling(tx, organizationId);
      const seats = await requireChangeableSeats(tx, organizationId, now);
      await requirePlanCoversRoster(tx, organizationId, plan);
      if (plan.seatLimit > billing.seatCount) {
        return leaseUpgrade(tx, seats, {
          leaseId: `${PLAN_LEASE_PREFIX}${(options.createLeaseId ?? randomUUID)()}`,
          now,
          paidCapacity: billing.seatCount,
          plan,
        });
      }
      await setRenewalPlan(tx, seats, plan, now);
      return {
        kind: plan.seatLimit < billing.seatCount ? "scheduled" : "kept",
      };
    },
  );
}

/**
 * Grants a paid upgrade: the outbox records the larger Price as applied, and
 * the licensed capacity rises (with its seat event) so members waiting for a
 * seat get one. Runs even when the lease lapsed meanwhile, because the
 * charge already went through.
 */
export async function runFinishStripePlanUpgradeWorkflow(
  db: ApiDatabase,
  input: {
    readonly leaseId: string;
    readonly now?: Date;
    readonly organizationId: string;
    readonly plan: SyncBillingTier;
    readonly priceId: string;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const target = input.plan.seatLimit;
  await db.transaction(async (tx) => {
    const billing = await lockActiveBilling(tx, input.organizationId);
    const seats = await readStripeSeats(tx, input.organizationId);
    if (seats) {
      await tx
        .update(organizationBillingStripeSeats)
        .set({
          appliedPaidCapacity: Math.max(seats.appliedPaidCapacity, target),
          desiredPaidCapacity: Math.max(seats.desiredPaidCapacity, target),
          desiredRenewalQuantity: target,
          desiredRevision: seats.desiredRevision + 1,
          nextAttemptAt: now,
          observedQuantity: target,
          priceId: input.priceId,
          updatedAt: now,
          ...(seats.leaseId === input.leaseId
            ? { leaseExpiresAt: null, leaseId: null }
            : {}),
        })
        .where(eq(organizationBillingStripeSeats.id, seats.id));
    }
    // A Stripe-store grant records its Stripe Price as the product, which a
    // later lifecycle event matches against the bound Price.
    if (!getSyncBillingTierForNativeProduct(billing.providerProductId)) {
      await tx
        .update(organizationBilling)
        .set({ providerProductId: input.priceId, updatedAt: now })
        .where(eq(organizationBilling.organizationId, input.organizationId));
    }
    await reconcileOrganizationBillingSeats({
      executor: tx,
      licensedSeatCount: Math.max(billing.seatCount, target),
      now,
      organizationId: input.organizationId,
      source: { sourceId: input.leaseId, sourceType: "billing_transition" },
    });
  });
}

/**
 * Releases an upgrade that was not paid: the renewal quantity it recorded
 * returns to what it was, unless another change replaced it meanwhile.
 */
export async function runAbandonStripePlanUpgradeWorkflow(
  db: ApiDatabase,
  input: {
    readonly leaseId: string;
    readonly now?: Date;
    readonly organizationId: string;
    readonly plan: SyncBillingTier;
    readonly previousRenewalQuantity: number;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await lockRowForUpdate(
      tx
        .select({ id: organizationBilling.organizationId })
        .from(organizationBilling)
        .where(eq(organizationBilling.organizationId, input.organizationId))
        .limit(1),
    );
    const seats = await readStripeSeats(tx, input.organizationId);
    if (seats?.leaseId !== input.leaseId) {
      return;
    }
    await tx
      .update(organizationBillingStripeSeats)
      .set({
        desiredRenewalQuantity:
          seats.desiredRenewalQuantity === input.plan.seatLimit
            ? input.previousRenewalQuantity
            : seats.desiredRenewalQuantity,
        desiredRevision: seats.desiredRevision + 1,
        leaseExpiresAt: null,
        leaseId: null,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(eq(organizationBillingStripeSeats.id, seats.id));
  });
}

/**
 * The smaller plan an active Stripe subscription renews at, or null when it
 * renews at its current capacity. Read for the billing snapshot.
 */
export async function resolvePendingStripeSeatCount(
  executor: DatabaseSession,
  organizationId: string,
  billing: { readonly seatCount: number; readonly status: string },
): Promise<number | null> {
  if (billing.status !== "active") {
    return null;
  }
  const seats = await readStripeSeats(executor, organizationId);
  if (!seats?.subscriptionId) {
    return null;
  }
  const renewal = getSyncBillingTierForSeatCount(
    Math.max(1, seats.desiredRenewalQuantity),
  );
  return renewal && renewal.seatLimit < billing.seatCount
    ? renewal.seatLimit
    : null;
}
