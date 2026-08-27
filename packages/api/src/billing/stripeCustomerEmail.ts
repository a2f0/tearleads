import {
  resolveDeps,
  type StripeApiDeps,
  StripeApiError,
  stripeRequest,
} from "./stripeHttp";
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

/**
 * Best-effort recovery setup after a subscription has been accepted locally.
 * Transient provider failures propagate for webhook redelivery; a permanent
 * client error is alerted but cannot undo or indefinitely block entitlement.
 */
export async function promoteCustomerEmail(
  binding: StripeSubscriptionBinding,
  subscriptionId: string,
  deps: StripeApiDeps = {},
): Promise<void> {
  try {
    if (!(await ensureStripeCustomerEmail(binding, deps))) {
      console.error("No Stripe billing recovery email", subscriptionId);
    }
  } catch (error) {
    if (
      error instanceof StripeApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 409, 429].includes(error.status)
    ) {
      console.error("Stripe billing recovery email update rejected", {
        status: error.status,
        subscriptionId,
      });
      return;
    }
    throw error;
  }
}
