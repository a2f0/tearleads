import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { OrganizationsRouterDeps } from "../organizations/shared";
import { createOrganizationBillingRoute } from "./organizationBilling";
import { createRevenueCatWebhookRoute } from "./revenuecatWebhook";
import { createStripeCheckoutRoute } from "./stripeCheckout";
import { createStripeWebhookRoute } from "./stripeWebhook";

/**
 * Billing routes are authed but NOT behind the paid sync gate: an admin must be
 * able to read billing and start a trial on a `local` (unpaid) organization.
 * Mount with the plain `requireAuth`.
 *
 * The RevenueCat and Stripe webhooks are the exception: they are
 * server-to-server callbacks authenticated by their own shared secret /
 * signature rather than a user session, so they are mounted without
 * `requireAuth`.
 */
export function createBillingRouter(deps: OrganizationsRouterDeps) {
  const billingRouter = new Hono<SessionEnv>();

  billingRouter.route("/", createOrganizationBillingRoute(deps));
  billingRouter.route("/", createRevenueCatWebhookRoute(deps.runtime));
  billingRouter.route("/", createStripeCheckoutRoute(deps));
  billingRouter.route("/", createStripeWebhookRoute(deps.runtime));

  return billingRouter;
}
