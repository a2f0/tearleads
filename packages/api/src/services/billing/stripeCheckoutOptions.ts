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
  const { tierId } = await runRequireCheckoutEligibleWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isDirectCheckoutFullyConfigured(deps)) {
    return { options: [] };
  }
  const option = await getStripeSyncOption(tierId, deps.stripe ?? {});
  return { options: option ? [option] : [] };
}
