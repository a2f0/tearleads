import { isPlainObject } from "../isPlainObject";
import {
  hasBooleanProperty,
  hasNullableStringProperty,
  hasStringProperty,
} from "../util";

export type OrganizationBillingSubscriptionSource = "native" | "stripe";

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
  /** Our API can cancel this Stripe subscription from any app surface. */
  canCancelDirectly: boolean;
  managementUrl: string | null;
  /** Purchase system that owns the active subscription, when recognized. */
  subscriptionSource: OrganizationBillingSubscriptionSource | null;
}

export function isOrganizationBillingManagementUrlResponse(
  value: unknown,
): value is OrganizationBillingManagementUrlResponse {
  if (!isPlainObject(value)) {
    return false;
  }
  const { subscriptionSource } = value;
  return (
    hasBooleanProperty(value, "canCancelDirectly") &&
    hasNullableStringProperty(value, "managementUrl") &&
    (subscriptionSource === null ||
      (hasStringProperty(value, "subscriptionSource") &&
        (value.subscriptionSource === "native" ||
          value.subscriptionSource === "stripe")))
  );
}
