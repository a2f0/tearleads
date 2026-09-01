import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { organizationSeatPeriodKey } from "../../billing/organizationBilling";
import { normalizeStripeSeatQuantity } from "../../billing/stripeSeatQuantity";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import { resolveStripeSeatBindingOrder } from "./stripeSeatBindingOrder";

export interface StripeSeatBindingInput {
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly customerId: string | null;
  readonly organizationId: string;
  readonly priceId: string;
  readonly seatQuantity: number;
  readonly subscriptionId: string;
  readonly subscriptionItemId: string;
}

type StripeSeatBindingOutcome =
  | { readonly status: "accepted" }
  | { readonly status: "retry" }
  | { readonly status: "stale" };

type StripeSeatStateRow = typeof organizationBillingStripeSeats.$inferSelect;

function resolveBindingState(
  billing: {
    readonly seatCount: number;
    readonly seatPeriodKey: string | null;
  },
  current: StripeSeatStateRow | undefined,
  binding: StripeSeatBindingInput,
  bindingPeriodKey: string,
) {
  const bindingQuantity = normalizeStripeSeatQuantity(binding.seatQuantity);
  const sameSubscription = current?.subscriptionId === binding.subscriptionId;
  const sameAppliedPeriod =
    sameSubscription && current?.appliedSeatPeriodKey === bindingPeriodKey;
  const sameDesiredPeriod =
    sameSubscription && current?.desiredSeatPeriodKey === bindingPeriodKey;
  const preserveInFlight = sameAppliedPeriod && sameDesiredPeriod;
  const desiredRenewalQuantity = normalizeStripeSeatQuantity(
    current?.desiredRenewalQuantity ?? bindingQuantity,
  );
  return {
    appliedPaidCapacity: sameAppliedPeriod
      ? Math.max(current?.appliedPaidCapacity ?? 0, bindingQuantity)
      : bindingQuantity,
    bindingPeriodKey,
    bindingQuantity,
    desiredPaidCapacity: Math.max(
      bindingQuantity,
      desiredRenewalQuantity,
      sameDesiredPeriod ? (current?.desiredPaidCapacity ?? 0) : 0,
      billing.seatPeriodKey === bindingPeriodKey ? billing.seatCount : 0,
    ),
    desiredRenewalQuantity,
    inFlightOperationId: preserveInFlight
      ? (current?.inFlightOperationId ?? null)
      : null,
    inFlightTargetCapacity: preserveInFlight
      ? (current?.inFlightTargetCapacity ?? null)
      : null,
    leaseExpiresAt: preserveInFlight ? (current?.leaseExpiresAt ?? null) : null,
    leaseId: preserveInFlight ? (current?.leaseId ?? null) : null,
  };
}

function paidSeatPeriodKey(binding: StripeSeatBindingInput): string {
  if (
    !binding.billingPeriodStartsAt ||
    !binding.billingPeriodEndsAt ||
    binding.billingPeriodEndsAt <= binding.billingPeriodStartsAt
  ) {
    throw new Error("Stripe subscription has an invalid billing period");
  }
  return organizationSeatPeriodKey({
    currentPeriodEndsAt: binding.billingPeriodEndsAt,
    currentPeriodStartsAt: binding.billingPeriodStartsAt,
    status: "active",
    trialEndsAt: null,
  });
}

function seatPeriodOrder(
  key: string,
): readonly [number, number, number] | null {
  if (key.startsWith("trial:")) {
    const endsAt = Date.parse(key.slice("trial:".length));
    return Number.isFinite(endsAt) ? [0, endsAt, endsAt] : null;
  }
  if (!key.startsWith("paid:")) {
    return null;
  }
  const startsAt = Date.parse(key.slice("paid:".length, "paid:".length + 24));
  const endsAt = Date.parse(key.slice("paid:".length + 25));
  return Number.isFinite(startsAt) && Number.isFinite(endsAt)
    ? [1, startsAt, endsAt]
    : null;
}

function seatPeriodIsOlder(candidate: string, reference: string): boolean {
  const candidateOrder = seatPeriodOrder(candidate);
  const referenceOrder = seatPeriodOrder(reference);
  if (!candidateOrder || !referenceOrder) {
    return false;
  }
  for (const index of [0, 1, 2] as const) {
    if (candidateOrder[index] !== referenceOrder[index]) {
      return candidateOrder[index] < referenceOrder[index];
    }
  }
  return false;
}

/** Coalesces roster changes into one absolute desired Stripe state. */
export async function requestOrganizationStripeSeatSync(input: {
  readonly desiredPaidCapacity: number;
  readonly desiredRenewalQuantity: number;
  readonly desiredSeatPeriodKey: string;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
}): Promise<void> {
  const desiredPaidCapacity = normalizeStripeSeatQuantity(
    input.desiredPaidCapacity,
  );
  const desiredRenewalQuantity = normalizeStripeSeatQuantity(
    input.desiredRenewalQuantity,
  );
  const [current] = await input.executor
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, input.organizationId),
    )
    .limit(1);
  const providerPeriodIsNewer =
    current !== undefined &&
    current.subscriptionId !== null &&
    current.appliedSeatPeriodKey !== null &&
    seatPeriodIsOlder(input.desiredSeatPeriodKey, current.appliedSeatPeriodKey);
  const desiredSeatPeriodKey = providerPeriodIsNewer
    ? current.appliedSeatPeriodKey
    : input.desiredSeatPeriodKey;
  const periodPaidCapacity = providerPeriodIsNewer
    ? Math.max(
        current.appliedPaidCapacity,
        desiredRenewalQuantity,
        current.desiredSeatPeriodKey === current.appliedSeatPeriodKey
          ? current.desiredPaidCapacity
          : 0,
      )
    : desiredPaidCapacity;
  await input.executor
    .insert(organizationBillingStripeSeats)
    .values({
      desiredPaidCapacity: periodPaidCapacity,
      desiredRenewalQuantity,
      desiredSeatPeriodKey,
      desiredRevision: 1,
      nextAttemptAt: input.now,
      organizationId: input.organizationId,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: organizationBillingStripeSeats.organizationId,
      set: {
        desiredPaidCapacity: periodPaidCapacity,
        desiredRenewalQuantity,
        desiredSeatPeriodKey,
        desiredRevision: sql`${organizationBillingStripeSeats.desiredRevision} + 1`,
        nextAttemptAt: input.now,
        updatedAt: input.now,
      },
    });
}

async function bindOrganizationStripeSeatsInTransaction(
  executor: DatabaseSession,
  binding: StripeSeatBindingInput,
  now: Date,
): Promise<StripeSeatBindingOutcome> {
  const billingQuery = executor
    .select({
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      seatCount: organizationBilling.seatCount,
      seatPeriodKey: organizationBilling.seatPeriodKey,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, binding.organizationId))
    .limit(1);
  const [billing] = isSqliteApiDatabase()
    ? await billingQuery
    : await billingQuery.for("update", { of: organizationBilling });
  if (!billing) {
    throw new Error("Organization billing not found for Stripe subscription");
  }
  if (billing.status === "deleting" || billing.status === "purged") {
    return { status: "stale" };
  }

  const [current] = await executor
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, binding.organizationId),
    )
    .limit(1);
  const bindingPeriodKey = paidSeatPeriodKey(binding);
  const bindingOrder = resolveStripeSeatBindingOrder({
    billingProviderSubscriptionId: billing.providerSubscriptionId,
    candidate: binding,
    current,
  });
  if (bindingOrder !== "accepted") {
    return { status: bindingOrder };
  }
  const state = resolveBindingState(
    billing,
    current,
    binding,
    bindingPeriodKey,
  );

  if (!current) {
    await executor.insert(organizationBillingStripeSeats).values({
      ...binding,
      appliedPaidCapacity: state.appliedPaidCapacity,
      desiredPaidCapacity: state.desiredPaidCapacity,
      desiredRenewalQuantity: state.desiredRenewalQuantity,
      desiredRevision: 1,
      desiredSeatPeriodKey: state.bindingPeriodKey,
      nextAttemptAt: now,
      observedQuantity: state.bindingQuantity,
      appliedSeatPeriodKey: state.bindingPeriodKey,
      updatedAt: now,
    });
    return { status: "accepted" };
  }

  const sameSubscription = current.subscriptionId === binding.subscriptionId;
  await executor
    .update(organizationBillingStripeSeats)
    .set({
      appliedPaidCapacity: state.appliedPaidCapacity,
      billingPeriodEndsAt: binding.billingPeriodEndsAt,
      billingPeriodStartsAt: binding.billingPeriodStartsAt,
      customerId: binding.customerId,
      desiredPaidCapacity: state.desiredPaidCapacity,
      desiredRenewalQuantity: state.desiredRenewalQuantity,
      desiredRevision: current.desiredRevision + 1,
      desiredSeatPeriodKey: state.bindingPeriodKey,
      inFlightOperationId: state.inFlightOperationId,
      inFlightTargetCapacity: state.inFlightTargetCapacity,
      lastInvoiceId: sameSubscription ? current.lastInvoiceId : null,
      leaseExpiresAt: state.leaseExpiresAt,
      leaseId: state.leaseId,
      nextAttemptAt: now,
      observedQuantity: state.bindingQuantity,
      priceId: binding.priceId,
      appliedSeatPeriodKey: state.bindingPeriodKey,
      subscriptionId: binding.subscriptionId,
      subscriptionItemId: binding.subscriptionItemId,
      updatedAt: now,
    })
    .where(eq(organizationBillingStripeSeats.id, current.id));
  return { status: "accepted" };
}

/** Persists the exact Stripe subscription item before RevenueCat association. */
export async function runBindOrganizationStripeSeatsWorkflow(
  db: ApiDatabase,
  binding: StripeSeatBindingInput,
  now: Date = new Date(),
): Promise<StripeSeatBindingOutcome> {
  return db.transaction((tx) =>
    bindOrganizationStripeSeatsInTransaction(tx, binding, now),
  );
}

/** Records the invoice after the binding establishes its provider period. */
export async function runRecordStripeSeatRenewalWorkflow(
  db: ApiDatabase,
  input: StripeSeatBindingInput & { readonly invoiceId: string },
  now: Date = new Date(),
): Promise<StripeSeatBindingOutcome> {
  return db.transaction(async (tx) => {
    const outcome = await bindOrganizationStripeSeatsInTransaction(
      tx,
      input,
      now,
    );
    if (outcome.status !== "accepted") {
      return outcome;
    }
    await tx
      .update(organizationBillingStripeSeats)
      .set({ lastInvoiceId: input.invoiceId, updatedAt: now })
      .where(
        and(
          eq(
            organizationBillingStripeSeats.organizationId,
            input.organizationId,
          ),
          eq(
            organizationBillingStripeSeats.subscriptionId,
            input.subscriptionId,
          ),
          eq(
            organizationBillingStripeSeats.subscriptionItemId,
            input.subscriptionItemId,
          ),
        ),
      );
    return outcome;
  });
}
