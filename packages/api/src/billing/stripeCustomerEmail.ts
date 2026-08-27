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
  const customerEmail = binding.customerEmail?.trim();
  const paymentMethodEmail = binding.paymentMethodBillingEmail?.trim();
  if (!paymentMethodEmail) {
    return Boolean(customerEmail);
  }
  if (customerEmail === paymentMethodEmail) {
    return true;
  }
  if (!binding.customerId) {
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
    form: new URLSearchParams({ email: paymentMethodEmail }),
  });
  return true;
}
