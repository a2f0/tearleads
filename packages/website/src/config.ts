const publicEnvironment = import.meta.env.PUBLIC_ENVIRONMENT;
export const isStaging = publicEnvironment === "staging";

export const appUrl = isStaging
  ? "https://app-staging.symcrypt.com"
  : "https://app.symcrypt.com";

export function resolveStripeCustomerPortalUrl(
  rawValue: string | undefined,
  required: boolean,
): string | null {
  const value = rawValue?.trim();
  if (!value) {
    if (required) {
      throw new Error(
        "PUBLIC_STRIPE_CUSTOMER_PORTAL_URL is required for website deployments",
      );
    }
    return null;
  }
  const url = new URL(value);
  if (url.origin !== "https://billing.stripe.com") {
    throw new Error(
      "PUBLIC_STRIPE_CUSTOMER_PORTAL_URL must be a Stripe-hosted HTTPS URL",
    );
  }
  return url.toString();
}

const isDeployment =
  publicEnvironment === "production" || publicEnvironment === "staging";
export const stripeCustomerPortalUrl = resolveStripeCustomerPortalUrl(
  import.meta.env.PUBLIC_STRIPE_CUSTOMER_PORTAL_URL,
  isDeployment,
);
