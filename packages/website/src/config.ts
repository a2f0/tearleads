const publicEnvironment = import.meta.env.PUBLIC_ENVIRONMENT;
export const isStaging = publicEnvironment === "staging";

export const appUrl = isStaging
  ? "https://app-staging.tearleads.com"
  : "https://app.tearleads.com";

/**
 * The site's release notice, shown by StatusNotice.astro under the label
 * "Early testing." in the Home hero, the Pricing header, and the Linux install
 * header. It mirrors the app's unconditional TestSystemBanner
 * (packages/app/src/components/layout/TestSystemBanner.tsx: "Test system. You
 * will lose data."). Set it to null in the same change that removes that
 * banner, then recapture the screenshots and recheck every figure's crops,
 * including the `phoneCrop` values on Home and Features, which are measured to
 * end above the banner (y ≈ 1765 of 1992).
 *
 * While it is non-null, phone figures may crop the banner out, because the
 * notice says the same thing. Only if it is set to null while the app still
 * shows the banner, pass phone={false} to every Screenshot.
 */
export const releaseNotice: string | null =
  "Tearleads is still in testing, and hosted data may be reset. Keep your own backups of anything important.";

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
