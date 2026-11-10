import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { voidUnpaidInvoice } from "../../billing/stripeCheckoutVoid";
import { getStripePriceIdForTier } from "../../billing/stripeHttp";
import {
  normalizeStripeSeatQuantity,
  StripeSeatQuantityInvalid,
  updateSubscriptionItemQuantity,
} from "../../billing/stripeSeatQuantity";
import {
  getSubscriptionBinding,
  type StripeSubscriptionBinding,
} from "../../billing/stripeSubscriptionBinding";
import { reportBackgroundFailure } from "../../diagnostics/reportBackgroundFailure";
import { runBindOrganizationStripeSeatsWorkflow } from "../../workflows/billing/stripeSeatState";
import {
  claimOrganizationStripeSeatSync,
  failOrganizationStripeSeatSync,
  releaseOrganizationStripeSeatSyncClaim,
  runCompleteOrganizationStripeSeatSyncWorkflow,
  type StripeSeatSyncClaim,
} from "../../workflows/billing/stripeSeatSyncClaim";
import type { ApiServiceRuntime } from "../runtime";

const DEFAULT_LIMIT = 100;
const PRORATION_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
]);

interface StripeSeatSyncDeps {
  readonly stripe?: StripeApiDeps;
}

interface StripeSeatSyncSummary {
  readonly attempted: number;
  readonly failed: number;
  readonly synced: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Stripe seat error";
}

interface ValidSeatBinding {
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly customerId: string | null;
  readonly priceId: string;
  readonly seatQuantity: number;
  readonly status: string | null;
  readonly subscriptionItemId: string;
}

class StripeSeatPeriodRebound extends Error {}
class StripeSeatBindingInvalid extends Error {}

function validateSeatBinding(
  claim: StripeSeatSyncClaim,
  binding: StripeSubscriptionBinding | null,
): ValidSeatBinding {
  if (
    !binding ||
    binding.organizationId !== claim.organizationId ||
    !binding.subscriptionItemId ||
    !binding.priceId ||
    !binding.seatQuantity
  ) {
    // getSubscriptionBinding exposes seatQuantity only when the item's Price
    // maps to a configured fixed tier, so this also rejects rotated Prices.
    throw new StripeSeatBindingInvalid(
      "Stripe subscription has no valid organization seat item",
    );
  }
  return {
    billingPeriodEndsAt: binding.billingPeriodEndsAt,
    billingPeriodStartsAt: binding.billingPeriodStartsAt,
    customerId: binding.customerId,
    priceId: binding.priceId,
    seatQuantity: binding.seatQuantity,
    status: binding.status,
    subscriptionItemId: binding.subscriptionItemId,
  };
}

function bindingMatchesClaimPeriod(
  claim: StripeSeatSyncClaim,
  binding: ValidSeatBinding,
): boolean {
  return (
    claim.billingPeriodStartsAt !== null &&
    claim.billingPeriodEndsAt !== null &&
    binding.billingPeriodStartsAt?.getTime() ===
      claim.billingPeriodStartsAt.getTime() &&
    binding.billingPeriodEndsAt?.getTime() ===
      claim.billingPeriodEndsAt.getTime()
  );
}

async function rebindAdvancedPeriod(
  runtime: ApiServiceRuntime,
  claim: StripeSeatSyncClaim,
  binding: ValidSeatBinding,
  now: Date,
): Promise<never> {
  const outcome = await runBindOrganizationStripeSeatsWorkflow(
    runtime.db,
    {
      billingPeriodEndsAt: binding.billingPeriodEndsAt,
      billingPeriodStartsAt: binding.billingPeriodStartsAt,
      customerId: binding.customerId,
      organizationId: claim.organizationId,
      priceId: binding.priceId,
      seatQuantity: binding.seatQuantity,
      subscriptionId: claim.subscriptionId,
      subscriptionItemId: binding.subscriptionItemId,
    },
    now,
  );
  if (outcome.status === "retry") {
    throw new Error("Stripe subscription replacement order is ambiguous");
  }
  await releaseOrganizationStripeSeatSyncClaim({
    claim,
    executor: runtime.db,
    now,
  });
  throw new StripeSeatPeriodRebound();
}

/**
 * Voids the open invoice of a plan upgrade whose payment did not go through
 * when its request died before voiding it (billing/stripePlanUpgrade.ts), so
 * it is never charged later. One paid meanwhile lets Stripe apply the
 * upgrade, which the claim's retry then reads and grants.
 */
async function voidAbandonedUpgradeInvoice(
  binding: StripeSubscriptionBinding | null,
  deps: StripeSeatSyncDeps,
): Promise<void> {
  if (
    binding?.pendingInvoiceId &&
    !(await voidUnpaidInvoice(binding.pendingInvoiceId, deps.stripe ?? {}))
  ) {
    throw new Error("A pending Stripe plan upgrade was paid; retrying");
  }
}

function requireProrationEligibleStatus(
  status: string | null,
  operationId: string | null,
  operationTarget: number | null,
  paidCapacity: number,
): void {
  if (
    operationId &&
    operationTarget &&
    operationTarget > paidCapacity &&
    (!status || !PRORATION_ELIGIBLE_STATUSES.has(status))
  ) {
    throw new Error(
      `Stripe subscription status ${status ?? "unknown"} cannot accept seat prorations`,
    );
  }
}

async function setQuantity(input: {
  readonly claim: StripeSeatSyncClaim;
  readonly idempotencyKey: string;
  readonly prorationBehavior: "create_prorations" | "none";
  readonly seatQuantity: number;
  readonly stripe: StripeApiDeps | undefined;
  readonly subscriptionItemId: string;
}): Promise<void> {
  const updated = await updateSubscriptionItemQuantity(
    {
      idempotencyKey: input.idempotencyKey,
      prorationBehavior: input.prorationBehavior,
      seatQuantity: input.seatQuantity,
      subscriptionItemId: input.subscriptionItemId,
    },
    input.stripe ?? {},
  );
  if (!updated) {
    throw new Error("Stripe seat synchronization is not configured");
  }
}

/**
 * Runs the claim's in-flight capacity operation: restores the paid baseline
 * and prorates up to its target. Returns the capacity paid for and the
 * quantity Stripe now holds.
 */
async function applyCapacityOperation(input: {
  readonly binding: ValidSeatBinding;
  readonly claim: StripeSeatSyncClaim;
  readonly deps: StripeSeatSyncDeps;
  readonly paidCapacity: number;
}): Promise<{
  readonly observedQuantity: number;
  readonly paidCapacity: number;
}> {
  const { binding, claim, deps } = input;
  let { paidCapacity } = input;
  let observedQuantity = binding.seatQuantity;
  const operationId = claim.inFlightOperationId;
  const operationTarget =
    claim.inFlightTargetCapacity === null
      ? null
      : normalizeStripeSeatQuantity(claim.inFlightTargetCapacity);
  requireProrationEligibleStatus(
    binding.status,
    operationId,
    operationTarget,
    paidCapacity,
  );
  if (operationId && operationTarget && operationTarget > paidCapacity) {
    if (observedQuantity < paidCapacity) {
      await setQuantity({
        claim,
        idempotencyKey:
          `seat-baseline:${claim.organizationId}:` +
          `${claim.leaseId}:${paidCapacity}`,
        prorationBehavior: "none",
        seatQuantity: paidCapacity,
        stripe: deps.stripe,
        subscriptionItemId: binding.subscriptionItemId,
      });
      observedQuantity = paidCapacity;
    }
    if (observedQuantity < operationTarget) {
      await setQuantity({
        claim,
        idempotencyKey: `seat-capacity:${claim.organizationId}:${operationId}`,
        prorationBehavior: "create_prorations",
        seatQuantity: operationTarget,
        stripe: deps.stripe,
        subscriptionItemId: binding.subscriptionItemId,
      });
      observedQuantity = operationTarget;
    }
    paidCapacity = operationTarget;
  } else if (operationTarget) {
    paidCapacity = Math.max(paidCapacity, operationTarget);
  }
  return { observedQuantity, paidCapacity };
}

async function synchronizeClaim(
  runtime: ApiServiceRuntime,
  claim: StripeSeatSyncClaim,
  deps: StripeSeatSyncDeps,
  now: Date,
): Promise<{
  readonly appliedPaidCapacity: number;
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  /** A renewal plan to record, from a paid upgrade found in Stripe. */
  readonly desiredRenewalQuantity: number | null;
  readonly observedQuantity: number;
  readonly priceId: string;
  readonly subscriptionItemId: string;
}> {
  const subscription = await getSubscriptionBinding(
    claim.subscriptionId,
    deps.stripe ?? {},
  );
  await voidAbandonedUpgradeInvoice(subscription, deps);
  const binding = validateSeatBinding(claim, subscription);
  if (!bindingMatchesClaimPeriod(claim, binding)) {
    await rebindAdvancedPeriod(runtime, claim, binding, now);
  }

  const samePeriod = claim.desiredSeatPeriodKey === claim.appliedSeatPeriodKey;
  const capacity = await applyCapacityOperation({
    binding,
    claim,
    deps,
    paidCapacity: normalizeStripeSeatQuantity(
      samePeriod
        ? Math.max(claim.appliedPaidCapacity, binding.seatQuantity)
        : binding.seatQuantity,
    ),
  });
  const { paidCapacity } = capacity;
  let { observedQuantity } = capacity;

  // A sticky capacity operation can lag a newer coalesced roster target. Never
  // let the no-proration renewal update jump past the capacity this claim has
  // actually paid for; the next claim will prorate the remaining increase.
  const recoveredRenewal = recoveredUpgradeQuantity(claim, binding, samePeriod);
  const desiredQuantity = Math.min(
    normalizeStripeSeatQuantity(
      recoveredRenewal ?? claim.desiredRenewalQuantity,
    ),
    paidCapacity,
  );
  const desiredTier = getSyncBillingTierForSeatCount(desiredQuantity);
  if (!desiredTier) {
    throw new Error("Stripe seat target has no configured billing tier");
  }
  // When the prorated capacity write already landed exactly on the renewal
  // tier, omit a redundant no-proration confirm write; completion compares the
  // observed and expected quantities from this returned snapshot.
  if (observedQuantity !== desiredQuantity) {
    await setQuantity({
      claim,
      idempotencyKey:
        `seat-renewal:${claim.organizationId}:` +
        `${claim.leaseId}:${desiredQuantity}`,
      prorationBehavior: "none",
      seatQuantity: desiredQuantity,
      stripe: deps.stripe,
      subscriptionItemId: binding.subscriptionItemId,
    });
    observedQuantity = desiredQuantity;
  }

  return {
    appliedPaidCapacity: paidCapacity,
    billingPeriodEndsAt: binding.billingPeriodEndsAt,
    billingPeriodStartsAt: binding.billingPeriodStartsAt,
    desiredRenewalQuantity: recoveredRenewal,
    observedQuantity,
    priceId:
      getStripePriceIdForTier(desiredTier.id, deps.stripe ?? {}) ??
      binding.priceId,
    subscriptionItemId: binding.subscriptionItemId,
  };
}

/**
 * Stripe holds a larger Price than the capacity recorded for this period
 * only after a paid upgrade whose request never finished
 * (services/billing/stripePlanChange.ts): its plan is now the renewal plan,
 * which completion records. Null otherwise.
 */
function recoveredUpgradeQuantity(
  claim: StripeSeatSyncClaim,
  binding: ValidSeatBinding,
  samePeriod: boolean,
): number | null {
  return samePeriod && binding.seatQuantity > claim.appliedPaidCapacity
    ? normalizeStripeSeatQuantity(binding.seatQuantity)
    : null;
}

/** Drains durable absolute seat targets without holding DB locks over HTTP. */
export async function runStripeSeatSynchronization(
  runtime: ApiServiceRuntime,
  options: { readonly limit?: number; readonly now?: Date } = {},
  deps: StripeSeatSyncDeps = {},
): Promise<StripeSeatSyncSummary> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  let attempted = 0;
  let failed = 0;
  let synced = 0;

  while (attempted < limit) {
    const claim = await claimOrganizationStripeSeatSync(runtime.db, now);
    if (!claim) {
      break;
    }
    attempted += 1;
    try {
      const result = await synchronizeClaim(runtime, claim, deps, now);
      await runCompleteOrganizationStripeSeatSyncWorkflow(runtime.db, {
        ...result,
        claim,
        now,
      });
      synced += 1;
    } catch (error) {
      if (error instanceof StripeSeatPeriodRebound) {
        continue;
      }
      if (
        error instanceof StripeSeatBindingInvalid ||
        error instanceof StripeSeatQuantityInvalid
      ) {
        console.error(
          `Stripe seat sync for organization ${claim.organizationId} requires attention: ${error.message}`,
        );
      }
      // Every remaining failure is counted and then dropped, so the exit status
      // is the only trace a per-minute timer leaves behind. A rebound period is
      // ordinary contention and already returned above.
      reportBackgroundFailure(error, "billing.seat-sync");
      failed += 1;
      await failOrganizationStripeSeatSync({
        claim,
        error: errorMessage(error),
        executor: runtime.db,
        now,
      });
    }
  }

  return { attempted, failed, synced };
}
