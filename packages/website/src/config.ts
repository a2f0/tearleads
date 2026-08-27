export const isStaging = import.meta.env.PUBLIC_ENVIRONMENT === "staging";

export const appUrl = isStaging
  ? "https://app-staging.symcrypt.com"
  : "https://app.symcrypt.com";

function readStripeCustomerPortalUrl(): string | null {
  const value = import.meta.env.PUBLIC_STRIPE_CUSTOMER_PORTAL_URL?.trim();
  if (!value) {
    return null;
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "billing.stripe.com") {
    throw new Error(
      "PUBLIC_STRIPE_CUSTOMER_PORTAL_URL must be a Stripe-hosted HTTPS URL",
    );
  }
  return url.toString();
}

export const stripeCustomerPortalUrl = readStripeCustomerPortalUrl();
