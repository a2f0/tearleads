const publicEnvironment = import.meta.env.PUBLIC_ENVIRONMENT;
export const isStaging = publicEnvironment === "staging";

export const appUrl = isStaging
  ? "https://app-staging.tearleads.com"
  : "https://app.tearleads.com";

/**
 * The staging iOS app (com.tearleads.staging.app) ships only through
 * TestFlight, so staging links its external group's public join link.
 * Production links the com.tearleads.app App Store record, which 404s until
 * Apple approves the app for sale.
 */
export const iosDownloadUrl = isStaging
  ? "https://testflight.apple.com/join/JGZxEWQD"
  : "https://apps.apple.com/app/id6793172063";

/**
 * Each tier's Google Play internal testing opt-in link. Neither Android app is
 * on a public track yet, so only testers added in Play Console can join.
 */
export const androidDownloadUrl = isStaging
  ? "https://play.google.com/apps/internaltest/4700608793048750781"
  : "https://play.google.com/apps/internaltest/4701368218502321967";

/**
 * The site's release notice, shown by StatusNotice.astro under the label
 * "Early access." in the Home hero, the screenshot gallery, and the Features,
 * Pricing, and Linux install headers. It carries the release status that the app's
 * TestSystemBanner (packages/app/src/shell/layout/TestSystemBanner.tsx) shows
 * in every deployment and that the website's phone and tablet captures leave
 * out (packages/app-web/screenshots/deviceScreen.ts). Set it to null in the
 * same change that removes that banner.
 */
export const releaseNotice: string | null =
  "While we test, hosted data can be reset, so keep a backup of anything important.";

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
