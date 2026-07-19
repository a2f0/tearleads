import { isPlainObject } from "../isPlainObject";
import { hasNullableStringProperty } from "../util";

/**
 * The subscription-management URL for an organization's paid subscription. The
 * server resolves it from the billing provider (RevenueCat) using the org's
 * stored customer id, so any org admin — not just the buyer whose device holds
 * the subscription — can reach the manage/cancel page. `managementUrl` is null
 * when the organization has no provider-managed subscription (it is local or
 * trial-only), the provider exposes no management link, or the lookup could not
 * be completed.
 */
export interface OrganizationBillingManagementUrlResponse {
  managementUrl: string | null;
}

export function isOrganizationBillingManagementUrlResponse(
  value: unknown,
): value is OrganizationBillingManagementUrlResponse {
  return (
    isPlainObject(value) && hasNullableStringProperty(value, "managementUrl")
  );
}
