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
  getSyncBillingTierForSeatCount,
  type SyncBillingTier,
} from "@tearleads/validators/billing";
import { eq } from "drizzle-orm";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import { OrganizationManagerError } from "../organizations/errors";
import { withOrganizationAdminTransaction } from "../organizations/mutationAccess";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";
import { hasActiveStripeBinding } from "./stripeBindingPolicy";
import { isSameBillingPeriod } from "./stripePeriodMatch";

/**
 * Plan changes for an organization's active Stripe subscription. The paid
 * capacity is `organization_billing.seat_count`; the Stripe seat outbox
 * (`organization_billing_stripe_seats`) carries the Price the subscription
 * renews at as `desired_renewal_quantity`, which the seat-sync worker
 * (services/billing/stripeSeatSync.ts) writes to Stripe without proration and
 * never above the paid capacity.
 *
 * - A smaller plan is scheduled: the service writes its Price to Stripe
 *   without proration and only then records it as the renewal quantity, so
 *   the current capacity stays until the renewal invoice, which Stripe
 *   charges at the smaller Price. No credit is given.
 * - Choosing the current plan keeps it, cancelling a scheduled change, the
 *   same way.
 * - A larger plan is an upgrade the service pays for in Stripe first. It
 *   leases the outbox row, so the worker cannot write the Price meanwhile,
 *   and grants capacity and the larger renewal plan only after the prorated
 *   charge succeeded. If the request never finishes, the worker finds the
 *   paid Price in Stripe and grants it, and a renewal choice waits until it
 *   has; an upgrade that never reached Stripe leaves the renewal plan as it
 *   was.
 */

const PLAN_LEASE_PREFIX = "plan:";
const PLAN_LEASE_MS = 5 * 60 * 1_000;
/** No change starts this close to the paid period's end. */
const RENEWAL_FREEZE_MS = 60 * 60 * 1_000;
/**
 * How long past a lapsed lease the worker waits before reconciling it: far
 * longer than Stripe takes to apply a request already sent.
 */
const PLAN_SETTLE_MS = 10 * 60 * 1_000;

export type StripeSeatRow = typeof organizationBillingStripeSeats.$inferSelect;

interface LeasedStripePlanChange {
  /** Stripe must not be written after this; the change is abandoned. */
  readonly chargeBy: Date;
  readonly leaseId: string;
  readonly subscriptionId: string;
  readonly subscriptionItemId: string;
}

export type BegunStripePlanChange =
  | (LeasedStripePlanChange & {
      /** A smaller plan for renewal, or keeping the current one. */
      readonly direction: "kept" | "scheduled";
      readonly kind: "renewal";
      readonly renewalSeatCount: number;
    })
  | (LeasedStripePlanChange & {
      readonly kind: "upgrade";
      /** The capacity paid for this period, before the upgrade. */
      readonly paidCapacity: number;
      /** The period that capacity was paid for, as last bound from Stripe. */
      readonly paidPeriodEndsAt: Date | null;
      readonly paidPeriodStartsAt: Date | null;
    });

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
export async function lockActiveBilling(
  executor: DatabaseSession,
  organizationId: string,
) {
  const [billing] = await lockRowForUpdate(
    executor
      .select({
        currentPeriodStartsAt: organizationBilling.currentPeriodStartsAt,
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
export async function readStripeSeats(
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
  // A retained Stripe identity without its Price is quarantined under native
  // ownership: it owns no capacity, so its plan cannot change here.
  if (
    !hasActiveStripeBinding(seats) ||
    !seats?.subscriptionId ||
    !seats.subscriptionItemId
  ) {
    throw stripePlanChangeUnavailable(
      "The organization has no Stripe subscription to change",
    );
  }
  // A held lease means another plan change, or the seat-sync worker, is
  // writing the subscription. Every change waits for it, so a renewal choice
  // never interleaves with a worker claim that may record a recovered
  // upgrade (stripeSeatSyncClaim.ts).
  if (seats.leaseExpiresAt !== null && seats.leaseExpiresAt > now) {
    throw stripePlanChangeUnavailable(
      "The subscription is being updated; try again shortly",
    );
  }
  // A plan change that never finished leaves its lapsed lease behind. Until
  // the worker reconciles it from Stripe, no newer choice is made against a
  // Price that change may still be moving.
  if (seats.leaseId?.startsWith(PLAN_LEASE_PREFIX) === true) {
    throw stripePlanChangeUnavailable(
      "A previous plan change is still settling; try again in a few minutes",
    );
  }
  return {
    ...seats,
    subscriptionId: seats.subscriptionId,
    subscriptionItemId: seats.subscriptionItemId,
  };
}

/**
 * Leases the outbox row for a change the service writes to Stripe, so the
 * worker cannot write the Price meanwhile. Nothing is recorded until Stripe
 * confirms it: an upgrade's renewal plan once it is paid, a renewal choice
 * once its Price is written.
 */
async function leaseChange(
  executor: DatabaseSession,
  seats: BoundStripeSeats,
  input: { readonly leaseId: string; readonly now: Date },
): Promise<LeasedStripePlanChange> {
  const { now } = input;
  // Stripe renews only at the period's end. Writing Stripe only within the
  // lease's first half, and starting no later than an hour before the end,
  // keeps every write inside the paid period, and leaves the worker time to
  // write back the recorded renewal plan's Price after a lease lapses.
  if (
    seats.billingPeriodEndsAt === null ||
    seats.billingPeriodEndsAt.getTime() - now.getTime() < RENEWAL_FREEZE_MS
  ) {
    throw stripePlanChangeUnavailable(
      "The subscription renews within the hour; change the plan after it renews",
    );
  }
  const leaseExpiresAt = new Date(now.getTime() + PLAN_LEASE_MS);
  await executor
    .update(organizationBillingStripeSeats)
    .set({
      leaseExpiresAt,
      leaseId: input.leaseId,
      // If this request never finishes (a lost response, a failed final
      // transaction, a Stripe write of unknown outcome), the lease is left
      // behind and fences the row until the seat-sync worker reconciles it,
      // which waits a settling time past the lapse so no write this request
      // sent can still apply in Stripe. The worker then grants an upgrade
      // Stripe was paid for, or writes back the recorded renewal plan's Price.
      nextAttemptAt: new Date(leaseExpiresAt.getTime() + PLAN_SETTLE_MS),
      updatedAt: now,
    })
    .where(eq(organizationBillingStripeSeats.id, seats.id));
  return {
    // Stripe is written only while at least half the lease remains, so once
    // it lapses the outcome in Stripe is final for the worker to find.
    chargeBy: new Date(now.getTime() + PLAN_LEASE_MS / 2),
    leaseId: input.leaseId,
    subscriptionId: seats.subscriptionId,
    subscriptionItemId: seats.subscriptionItemId,
  };
}

/** The subscription's plan as read from Stripe before a change begins. */
interface ObservedStripePlan {
  readonly billingPeriodStartsAt: Date | null;
  readonly seatCount: number | null;
  readonly subscriptionId: string;
}

/**
 * Every change is made against the subscription as Stripe reports it, which
 * must match what the organization has recorded:
 *
 * - Stripe in a later period than the one bound has renewed, and its
 *   webhooks have not arrived; billing in another period than the one bound
 *   has renewed through one provider before the other. A choice now would
 *   be scheduled or charged against another period's plan.
 * - Stripe holding a larger plan than the capacity recorded or granted for
 *   the period is a paid upgrade whose request died before recording it.
 *   The seat-sync worker grants it and records it as the renewal plan once
 *   its lease lapses; until then a renewal choice would be overwritten, and
 *   another plan would be priced from capacity not recorded.
 */
function requireStripeAtGrantedPlan(
  billing: {
    readonly currentPeriodStartsAt: Date | null;
    readonly seatCount: number;
  },
  seats: BoundStripeSeats,
  observed: ObservedStripePlan | null,
): void {
  if (
    observed?.subscriptionId !== seats.subscriptionId ||
    observed.billingPeriodStartsAt === null ||
    observed.billingPeriodStartsAt.getTime() !==
      seats.billingPeriodStartsAt?.getTime() ||
    !isSameBillingPeriod(billing.currentPeriodStartsAt, {
      endsAt: seats.billingPeriodEndsAt,
      startsAt: seats.billingPeriodStartsAt,
    })
  ) {
    throw stripePlanChangeUnavailable(
      "The subscription is renewing; try again in a moment",
    );
  }
  const observedSeatCount = observed.seatCount ?? 0;
  if (
    observedSeatCount > seats.appliedPaidCapacity ||
    observedSeatCount > billing.seatCount
  ) {
    throw stripePlanChangeUnavailable(
      "A previous upgrade is still being applied; try again in a minute",
    );
  }
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
    /** The paid capacity the admin chose against. */
    readonly currentSeatCount: number;
    readonly now?: Date;
    /** The subscription as Stripe reported it just before, if read. */
    readonly observed: ObservedStripePlan | null;
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
      // A renewal or another admin changed the plan since this choice was
      // shown: what it would do now (charge or not) may differ.
      if (billing.seatCount !== options.currentSeatCount) {
        throw stripePlanChangeUnavailable(
          "Your plan changed since you chose; review the plans and choose again",
        );
      }
      const seats = await requireChangeableSeats(tx, organizationId, now);
      await requirePlanCoversRoster(tx, organizationId, plan);
      requireStripeAtGrantedPlan(billing, seats, options.observed);
      const lease = await leaseChange(tx, seats, {
        leaseId: `${PLAN_LEASE_PREFIX}${(options.createLeaseId ?? randomUUID)()}`,
        now,
      });
      if (plan.seatLimit > billing.seatCount) {
        return {
          ...lease,
          kind: "upgrade",
          paidCapacity: billing.seatCount,
          paidPeriodEndsAt: seats.billingPeriodEndsAt,
          paidPeriodStartsAt: seats.billingPeriodStartsAt,
        };
      }
      return {
        ...lease,
        direction: plan.seatLimit < billing.seatCount ? "scheduled" : "kept",
        kind: "renewal",
        renewalSeatCount: plan.seatLimit,
      };
    },
  );
}

/** The organization's bound Stripe subscription, read before a change. */
export async function runReadStripePlanSubscriptionWorkflow(
  db: ApiDatabase,
  organizationId: string,
): Promise<string | null> {
  const seats = await readStripeSeats(db, organizationId);
  return hasActiveStripeBinding(seats) ? (seats?.subscriptionId ?? null) : null;
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
  if (!seats || !hasActiveStripeBinding(seats)) {
    return null;
  }
  const renewal = getSyncBillingTierForSeatCount(
    Math.max(1, seats.desiredRenewalQuantity),
  );
  return renewal && renewal.seatLimit < billing.seatCount
    ? renewal.seatLimit
    : null;
}
