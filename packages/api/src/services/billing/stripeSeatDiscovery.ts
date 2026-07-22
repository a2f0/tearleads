import {
  findLiveOrgSubscription,
  type StripeApiDeps,
} from "../../billing/stripeApi";
import { getSubscriptionBinding } from "../../billing/stripeSubscriptionBinding";
import {
  claimOrganizationStripeSeatDiscovery,
  completeOrganizationStripeSeatDiscovery,
  failOrganizationStripeSeatDiscovery,
  type StripeSeatDiscoveryClaim,
  seedLegacyOrganizationStripeSeats,
} from "../../workflows/billing/stripeSeatDiscovery";
import { runBindOrganizationStripeSeatsWorkflow } from "../../workflows/billing/stripeSeatState";
import type { ApiServiceRuntime } from "../runtime";

const LIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

interface StripeSeatDiscoverySummary {
  readonly attempted: number;
  readonly failed: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown Stripe seat discovery error";
}

async function discoverClaim(
  runtime: ApiServiceRuntime,
  claim: StripeSeatDiscoveryClaim,
  now: Date,
  stripe: StripeApiDeps | undefined,
): Promise<void> {
  const found = await findLiveOrgSubscription(
    claim.organizationId,
    stripe ?? {},
  );
  if (!found) {
    throw new Error("No live Stripe subscription found for organization");
  }
  const binding = await getSubscriptionBinding(
    found.subscriptionId,
    stripe ?? {},
  );
  if (
    !binding ||
    binding.organizationId !== claim.organizationId ||
    !binding.subscriptionItemId ||
    !binding.priceId ||
    !binding.seatQuantity ||
    !binding.status ||
    !LIVE_SUBSCRIPTION_STATUSES.has(binding.status)
  ) {
    throw new Error("Stripe subscription has no valid organization seat item");
  }

  const outcome = await runBindOrganizationStripeSeatsWorkflow(
    runtime.db,
    {
      billingPeriodEndsAt: binding.billingPeriodEndsAt,
      billingPeriodStartsAt: binding.billingPeriodStartsAt,
      customerId: binding.customerId ?? found.customerId,
      organizationId: claim.organizationId,
      priceId: binding.priceId,
      seatQuantity: binding.seatQuantity,
      subscriptionId: found.subscriptionId,
      subscriptionItemId: binding.subscriptionItemId,
    },
    now,
  );
  if (outcome.status === "retry") {
    throw new Error("Stripe subscription replacement order is ambiguous");
  }
  await completeOrganizationStripeSeatDiscovery({
    claim,
    executor: runtime.db,
    now,
  });
}

/** Seeds and binds legacy RevenueCat web rows before normal quantity sync. */
export async function runStripeSeatDiscovery(
  runtime: ApiServiceRuntime,
  options: { readonly limit: number; readonly now: Date },
  deps: { readonly stripe?: StripeApiDeps } = {},
): Promise<StripeSeatDiscoverySummary> {
  await seedLegacyOrganizationStripeSeats(runtime.db, options.now);
  let attempted = 0;
  let failed = 0;
  while (attempted < options.limit) {
    const claim = await claimOrganizationStripeSeatDiscovery(
      runtime.db,
      options.now,
    );
    if (!claim) {
      break;
    }
    attempted += 1;
    try {
      await discoverClaim(runtime, claim, options.now, deps.stripe);
    } catch (error) {
      failed += 1;
      await failOrganizationStripeSeatDiscovery({
        claim,
        error: errorMessage(error),
        executor: runtime.db,
        now: options.now,
      });
    }
  }
  return { attempted, failed };
}
