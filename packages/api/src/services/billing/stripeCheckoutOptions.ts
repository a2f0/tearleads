import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import {
  getStripeSyncOption,
  type StripeSyncOption,
} from "../../billing/stripeApi";
import { runRequireCheckoutEligibleWorkflow } from "../../workflows/billing/stripeCheckout";
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
  if (!isDirectCheckoutFullyConfigured(deps)) {
    // Preserve the organization-admin and checkout-eligibility gates even when
    // no provider option can be returned from this deployment.
    await runRequireCheckoutEligibleWorkflow(
      runtime.db,
      organizationId,
      sessionUserId,
    );
    return { options: [] };
  }
  const { seatQuantity } = await runRequireCheckoutEligibleWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  const tier = getSyncBillingTierForSeatCount(seatQuantity);
  if (!tier) throw new Error("Checkout returned an unavailable billing tier");
  const option = await getStripeSyncOption(tier.id, deps.stripe ?? {});
  return { options: option ? [option] : [] };
}
