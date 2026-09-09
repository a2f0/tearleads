import { z } from "zod";
import { loosePlainObject } from "../schema";

/**
 * The subscription-management URL for an organization's paid subscription. The
 * server resolves it from the billing provider (RevenueCat) using the org's
 * stored customer id, so any org admin — not just the buyer whose device holds
 * the subscription — can reach the manage/cancel page. Native management
 * remains available for lapsed subscriptions so the buyer can repair a payment
 * issue. `managementUrl` is null when the organization has no native
 * provider-managed subscription, the provider exposes no management link, or
 * the lookup could not be completed. Which purchase system owns the
 * subscription is part of the billing snapshot (`subscriptionSource`), not of
 * this response.
 */
export const OrganizationBillingManagementUrlResponseSchema = loosePlainObject({
  /** Retained for installed clients; current clients read this from the snapshot. */
  canCancelDirectly: z.boolean(),
  managementUrl: z.string().nullable(),
});

export type OrganizationBillingManagementUrlResponse = z.infer<
  typeof OrganizationBillingManagementUrlResponseSchema
>;

export function isOrganizationBillingManagementUrlResponse(
  value: unknown,
): value is OrganizationBillingManagementUrlResponse {
  return OrganizationBillingManagementUrlResponseSchema.safeParse(value)
    .success;
}
