import {
  BILLING_ERROR_CODES,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import {
  getStripeSyncOption,
  type StripeSyncOption,
} from "../../billing/stripeApi";
import { runRequireCheckoutEligibleWorkflow } from "../../workflows/billing/stripeCheckout";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
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
  const { seatQuantity } = await runRequireCheckoutEligibleWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isDirectCheckoutFullyConfigured(deps)) {
    return { options: [] };
  }
  const tier = getSyncBillingTierForSeatCount(seatQuantity);
  if (!tier) {
    throw new OrganizationManagerError(
      "The organization exceeds the maximum subscription tier of 10 members",
      409,
      BILLING_ERROR_CODES.rosterOverCapacity,
    );
  }
  const option = await getStripeSyncOption(tier.id, deps.stripe ?? {});
  return { options: option ? [option] : [] };
}
