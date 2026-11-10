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
import { hasActiveStripeBinding } from "./stripeBindingPolicy";

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
 *   leases the outbox row, so the worker cannot write the Price meanwhile,
 *   and grants capacity and the larger renewal plan only after the prorated
 *   charge succeeded. If the request never finishes, the worker finds the
 *   paid Price in Stripe and grants it, and a renewal choice waits until it
 *   has; an upgrade that never reached Stripe leaves the renewal plan as it
 *   was.
 */

const PLAN_LEASE_PREFIX = "plan:";
const PLAN_LEASE_MS = 5 * 60 * 1_000;

type StripeSeatRow = typeof organizationBillingStripeSeats.$inferSelect;

export type BegunStripePlanChange =
  | { readonly kind: "kept" | "scheduled" }
  | {
      /** Stripe must not be charged after this; the change is abandoned. */
      readonly chargeBy: Date;
      readonly kind: "upgrade";
      readonly leaseId: string;
      /** The capacity paid for this period, before the upgrade. */
      readonly paidCapacity: number;
      /** The period that capacity was paid for, as last bound from Stripe. */
      readonly paidPeriodEndsAt: Date | null;
      readonly paidPeriodStartsAt: Date | null;
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

/**
 * Renews at `plan`, or keeps renewing at the current one. A lapsed lease is
 * retired with it, so an upgrade that stalled past its lease cannot later
 * overwrite this newer choice when it finishes.
 */
async function setRenewalPlan(
  executor: DatabaseSession,
  seats: StripeSeatRow,
  plan: SyncBillingTier,
  now: Date,
): Promise<void> {
  const lapsedLease =
    seats.leaseId !== null &&
    (seats.leaseExpiresAt === null || seats.leaseExpiresAt <= now);
  if (seats.desiredRenewalQuantity === plan.seatLimit && !lapsedLease) {
    return;
  }
  await executor
    .update(organizationBillingStripeSeats)
    .set({
      desiredRenewalQuantity: plan.seatLimit,
      desiredRevision: seats.desiredRevision + 1,
      nextAttemptAt: now,
      updatedAt: now,
      ...(lapsedLease ? { leaseExpiresAt: null, leaseId: null } : {}),
    })
    .where(eq(organizationBillingStripeSeats.id, seats.id));
}

/**
 * Leases the outbox row for an upgrade. The renewal plan stays the admin's
 * previous choice until the upgrade is paid, so an upgrade that never
 * reaches Stripe leaves it exactly as it was.
 */
async function leaseUpgrade(
  executor: DatabaseSession,
  seats: BoundStripeSeats,
  input: {
    readonly leaseId: string;
    readonly now: Date;
    readonly paidCapacity: number;
  },
): Promise<BegunStripePlanChange> {
  const { now } = input;
  if (seats.leaseExpiresAt !== null && seats.leaseExpiresAt > now) {
    throw stripePlanChangeUnavailable(
      "The subscription is being updated; try again shortly",
    );
  }
  const leaseExpiresAt = new Date(now.getTime() + PLAN_LEASE_MS);
  await executor
    .update(organizationBillingStripeSeats)
    .set({
      leaseExpiresAt,
      leaseId: input.leaseId,
      // If this request never finishes (a lost response, a failed final
      // transaction), the seat-sync worker revisits the row once the lease
      // lapses and grants an upgrade Stripe was paid for.
      nextAttemptAt: leaseExpiresAt,
      updatedAt: now,
    })
    .where(eq(organizationBillingStripeSeats.id, seats.id));
  return {
    // Stripe is charged only while at least half the lease remains, so once
    // it lapses the outcome in Stripe is final for the worker to find.
    chargeBy: new Date(now.getTime() + PLAN_LEASE_MS / 2),
    kind: "upgrade",
    leaseId: input.leaseId,
    paidCapacity: input.paidCapacity,
    paidPeriodEndsAt: seats.billingPeriodEndsAt,
    paidPeriodStartsAt: seats.billingPeriodStartsAt,
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
 * Stripe holds a larger plan than the capacity recorded for the period: an
 * upgrade that was paid but whose request died before recording it. The
 * seat-sync worker records it as the renewal plan once its lease lapses, so
 * a renewal choice made before then would be overwritten; it waits instead.
 */
function upgradeAwaitingRecovery(
  seats: BoundStripeSeats,
  observed: ObservedStripePlan | null,
): boolean {
  return (
    observed?.subscriptionId === seats.subscriptionId &&
    observed.billingPeriodStartsAt !== null &&
    observed.billingPeriodStartsAt.getTime() ===
      seats.billingPeriodStartsAt?.getTime() &&
    (observed.seatCount ?? 0) > seats.appliedPaidCapacity
  );
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
      if (plan.seatLimit > billing.seatCount) {
        return leaseUpgrade(tx, seats, {
          leaseId: `${PLAN_LEASE_PREFIX}${(options.createLeaseId ?? randomUUID)()}`,
          now,
          paidCapacity: billing.seatCount,
        });
      }
      if (upgradeAwaitingRecovery(seats, options.observed)) {
        throw stripePlanChangeUnavailable(
          "A previous upgrade is still being applied; try again in a minute",
        );
      }
      await setRenewalPlan(tx, seats, plan, now);
      return {
        kind: plan.seatLimit < billing.seatCount ? "scheduled" : "kept",
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
 * Grants a paid upgrade: the paid capacity rises (with its seat event) so
 * members waiting for a seat get one, because the charge already went
 * through. Only while it still holds its lease does the upgrade also record
 * the larger Price as the renewal plan and the observed Price: once the
 * lease lapsed, a newer choice or the worker owns them, and the worker
 * reconciles them from Stripe. A subscription the organization no longer
 * binds, or one that renewed into a new period meanwhile (whose renewal
 * invoice already charged the larger Price), changes nothing here.
 */
export async function runFinishStripePlanUpgradeWorkflow(
  db: ApiDatabase,
  input: {
    readonly leaseId: string;
    readonly now?: Date;
    readonly organizationId: string;
    /** The period the upgrade's prorated charge paid for. */
    readonly paidPeriodEndsAt: Date | null;
    readonly plan: SyncBillingTier;
    readonly priceId: string;
    readonly subscriptionId: string;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const target = input.plan.seatLimit;
  await db.transaction(async (tx) => {
    const billing = await lockActiveBilling(tx, input.organizationId);
    const seats = await readStripeSeats(tx, input.organizationId);
    if (
      !seats ||
      seats.subscriptionId !== input.subscriptionId ||
      seats.billingPeriodEndsAt?.getTime() !== input.paidPeriodEndsAt?.getTime()
    ) {
      console.error(
        `Stripe plan upgrade for organization ${input.organizationId} finished after its subscription or period changed`,
      );
      return;
    }
    const leased = seats.leaseId === input.leaseId;
    await tx
      .update(organizationBillingStripeSeats)
      .set({
        appliedPaidCapacity: Math.max(seats.appliedPaidCapacity, target),
        desiredPaidCapacity: Math.max(seats.desiredPaidCapacity, target),
        desiredRevision: seats.desiredRevision + 1,
        nextAttemptAt: now,
        updatedAt: now,
        ...(leased
          ? {
              desiredRenewalQuantity: target,
              leaseExpiresAt: null,
              leaseId: null,
              observedQuantity: target,
              priceId: input.priceId,
            }
          : {}),
      })
      .where(eq(organizationBillingStripeSeats.id, seats.id));
    // A Stripe-store grant records its Stripe Price as the product, which a
    // later lifecycle event matches against the bound Price.
    if (
      leased &&
      !getSyncBillingTierForNativeProduct(billing.providerProductId)
    ) {
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
 * Releases an upgrade that was not paid. Its renewal plan was never
 * recorded, so only the lease is released, and the worker is due again to
 * restore a Price a scheduled smaller plan had lowered.
 */
export async function runAbandonStripePlanUpgradeWorkflow(
  db: ApiDatabase,
  input: {
    readonly leaseId: string;
    readonly now?: Date;
    readonly organizationId: string;
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
