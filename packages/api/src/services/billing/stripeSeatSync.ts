import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { getStripePriceIdForTier } from "../../billing/stripeHttp";
import {
  normalizeStripeSeatQuantity,
  updateSubscriptionItemQuantity,
} from "../../billing/stripeSeatQuantity";
import {
  getSubscriptionBinding,
  type StripeSubscriptionBinding,
} from "../../billing/stripeSubscriptionBinding";
import { runBindOrganizationStripeSeatsWorkflow } from "../../workflows/billing/stripeSeatState";
import {
  claimOrganizationStripeSeatSync,
  completeOrganizationStripeSeatSync,
  failOrganizationStripeSeatSync,
  releaseOrganizationStripeSeatSyncClaim,
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

async function synchronizeClaim(
  runtime: ApiServiceRuntime,
  claim: StripeSeatSyncClaim,
  deps: StripeSeatSyncDeps,
  now: Date,
): Promise<{
  readonly appliedPaidCapacity: number;
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly observedQuantity: number;
  readonly priceId: string;
  readonly subscriptionItemId: string;
}> {
  const binding = validateSeatBinding(
    claim,
    await getSubscriptionBinding(claim.subscriptionId, deps.stripe ?? {}),
  );
  if (!bindingMatchesClaimPeriod(claim, binding)) {
    await rebindAdvancedPeriod(runtime, claim, binding, now);
  }

  const samePeriod = claim.desiredSeatPeriodKey === claim.appliedSeatPeriodKey;
  let paidCapacity = normalizeStripeSeatQuantity(
    samePeriod
      ? Math.max(claim.appliedPaidCapacity, binding.seatQuantity)
      : binding.seatQuantity,
  );
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

  // A sticky capacity operation can lag a newer coalesced roster target. Never
  // let the no-proration renewal update jump past the capacity this claim has
  // actually paid for; the next claim will prorate the remaining increase.
  const desiredQuantity = Math.min(
    normalizeStripeSeatQuantity(claim.desiredRenewalQuantity),
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
    observedQuantity,
    priceId:
      getStripePriceIdForTier(desiredTier.id, deps.stripe ?? {}) ??
      binding.priceId,
    subscriptionItemId: binding.subscriptionItemId,
  };
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
      await completeOrganizationStripeSeatSync({
        ...result,
        claim,
        executor: runtime.db,
        now,
      });
      synced += 1;
    } catch (error) {
      if (error instanceof StripeSeatPeriodRebound) {
        continue;
      }
      if (error instanceof StripeSeatBindingInvalid) {
        console.error(
          `Stripe seat sync for organization ${claim.organizationId} requires attention: ${error.message}`,
        );
      }
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
