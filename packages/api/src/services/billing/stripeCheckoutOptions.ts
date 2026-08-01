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

/** Returns no options when the provider integration is unconfigured. */
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
  const { tierId } = await runRequireCheckoutEligibleWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  const option = await getStripeSyncOption(tierId, deps.stripe ?? {});
  return { options: option ? [option] : [] };
}
