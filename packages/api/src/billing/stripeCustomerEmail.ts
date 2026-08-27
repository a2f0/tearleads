import { resolveDeps, type StripeApiDeps, stripeRequest } from "./stripeHttp";
import type { StripeSubscriptionBinding } from "./stripeSubscriptionBinding";

/**
 * Promotes the payment-method email onto the Customer used by Stripe's
 * no-code portal. The update is safe to repeat when Stripe redelivers the
 * invoice webhook.
 */
export async function ensureStripeCustomerEmail(
  binding: StripeSubscriptionBinding,
  deps: StripeApiDeps = {},
): Promise<boolean> {
  if (binding.customerEmail) {
    return true;
  }
  if (!binding.customerId || !binding.paymentMethodBillingEmail) {
    return false;
  }
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return false;
  }
  await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: `/v1/customers/${encodeURIComponent(binding.customerId)}`,
    operation: "customer recovery email update",
    form: new URLSearchParams({ email: binding.paymentMethodBillingEmail }),
  });
  return true;
}
