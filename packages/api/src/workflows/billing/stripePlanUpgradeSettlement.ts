import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import {
  getSyncBillingTierForNativeProduct,
  type SyncBillingTier,
} from "@tearleads/validators/billing";
import { eq } from "drizzle-orm";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";
import { isSameBillingPeriod } from "./stripePeriodMatch";
import {
  lockActiveBilling,
  readStripeSeats,
  type StripeSeatRow,
} from "./stripePlanChange";

/**
 * Settles a change begun by `runBeginStripePlanChangeWorkflow`
 * (stripePlanChange.ts has the rules) once the service wrote it to Stripe:
 * records it once Stripe confirmed it, or releases it when it did not go
 * through.
 */

/**
 * Whether the upgrade still applies to the period it paid for: the
 * organization binds the same subscription in a period with the same start
 * (an extension moves only its end), and its billing has not renewed past it
 * (RevenueCat can deliver a renewal before Stripe's webhooks).
 */
function upgradeAppliesToPaidPeriod(
  billing: { readonly currentPeriodStartsAt: Date | null },
  seats: StripeSeatRow | undefined,
  input: FinishStripePlanUpgradeInput,
): seats is StripeSeatRow {
  return (
    seats !== undefined &&
    seats.subscriptionId === input.subscriptionId &&
    seats.billingPeriodStartsAt?.getTime() ===
      input.paidPeriodStartsAt?.getTime() &&
    isSameBillingPeriod(billing.currentPeriodStartsAt, {
      endsAt: input.paidPeriodEndsAt,
      startsAt: input.paidPeriodStartsAt,
    })
  );
}

interface FinishStripePlanUpgradeInput {
  readonly leaseId: string;
  readonly now?: Date;
  readonly organizationId: string;
  /** The period the upgrade's prorated charge paid for. */
  readonly paidPeriodEndsAt: Date | null;
  readonly paidPeriodStartsAt: Date | null;
  readonly plan: SyncBillingTier;
  readonly priceId: string;
  readonly subscriptionId: string;
}

/**
 * Grants a paid upgrade: the paid capacity rises (with its seat event) so
 * members waiting for a seat get one, because the charge already went
 * through. Only while it still holds its lease does the upgrade also record
 * the larger Price as the renewal plan and the observed Price: once the
 * lease lapsed, a newer choice or the worker owns them, and the worker
 * reconciles them from Stripe. A subscription the organization no longer
 * binds, or one that renewed into a new period meanwhile in Stripe or in
 * RevenueCat (whose renewal invoice already charged the Price it renews
 * at), changes nothing here.
 */
export async function runFinishStripePlanUpgradeWorkflow(
  db: ApiDatabase,
  input: FinishStripePlanUpgradeInput,
): Promise<void> {
  const now = input.now ?? new Date();
  const target = input.plan.seatLimit;
  await db.transaction(async (tx) => {
    const billing = await lockActiveBilling(tx, input.organizationId);
    const seats = await readStripeSeats(tx, input.organizationId);
    if (!upgradeAppliesToPaidPeriod(billing, seats, input)) {
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
 * Records a renewal choice whose Price the service wrote to Stripe while it
 * held the lease: the subscription renews at `renewalSeatCount`, and the
 * worker is due to audit it. False when the lease was lost meanwhile (it
 * lapsed and another change took the row), so nothing is recorded and the
 * worker writes back the Price of the recorded renewal plan.
 */
export async function runFinishStripeRenewalChangeWorkflow(
  db: ApiDatabase,
  input: {
    readonly leaseId: string;
    readonly now?: Date;
    readonly organizationId: string;
    readonly priceId: string;
    readonly renewalSeatCount: number;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockActiveBilling(tx, input.organizationId);
    const seats = await readStripeSeats(tx, input.organizationId);
    if (seats?.leaseId !== input.leaseId) {
      return false;
    }
    await tx
      .update(organizationBillingStripeSeats)
      .set({
        desiredRenewalQuantity: input.renewalSeatCount,
        desiredRevision: seats.desiredRevision + 1,
        leaseExpiresAt: null,
        leaseId: null,
        nextAttemptAt: now,
        observedQuantity: input.renewalSeatCount,
        priceId: input.priceId,
        updatedAt: now,
      })
      .where(eq(organizationBillingStripeSeats.id, seats.id));
    return true;
  });
}

/**
 * Releases a change that did not go through. Nothing was recorded, so only
 * the lease is released, and the worker is due again to write back the
 * Price of the recorded renewal plan.
 */
export async function runAbandonStripePlanChangeWorkflow(
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
