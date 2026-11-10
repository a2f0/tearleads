import { SYNC_BILLING_TIERS } from "@tearleads/validators/billing";
import {
  getStripeSyncOption,
  type StripeSyncOption,
} from "../../billing/stripeApi";
import {
  runRequireCheckoutEligibleWorkflow,
  runResolveOrgSubscriptionForAdminWorkflow,
} from "../../workflows/billing/stripeCheckout";
import type { ApiServiceRuntime } from "../runtime";
import {
  isDirectCheckoutFullyConfigured,
  type StripeCheckoutServiceDeps,
} from "./stripeCheckoutConfiguration";

/**
 * Every plan whose capacity covers the current roster, smallest first, for
 * the buyer to choose from. A plan whose Stripe Price is unusable is left
 * out. No options when the provider integration is unconfigured.
 */
export async function getStripeCheckoutOptions(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  deps: StripeCheckoutServiceDeps = {},
): Promise<{ options: StripeSyncOption[] }> {
  // Preserve the admin boundary even when checkout is disabled, but avoid the
  // signed-roster traversal until there is a provider flow to offer.
  await runResolveOrgSubscriptionForAdminWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isDirectCheckoutFullyConfigured(deps)) {
    return { options: [] };
  }
  const { rosterSeatCount } = await runRequireCheckoutEligibleWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  const options = await Promise.all(
    SYNC_BILLING_TIERS.filter((tier) => tier.seatLimit >= rosterSeatCount).map(
      (tier) => getStripeSyncOption(tier.id, deps.stripe ?? {}),
    ),
  );
  return {
    options: options.filter(
      (option): option is StripeSyncOption => option !== null,
    ),
  };
}
