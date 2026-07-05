import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { OrganizationsRouterDeps } from "../organizations/shared";
import { createOrganizationBillingRoute } from "./organizationBilling";
import { createRevenueCatWebhookRoute } from "./revenuecatWebhook";

/**
 * Billing routes are authed but NOT behind the paid sync gate: an admin must be
 * able to read billing and start a trial on a `local` (unpaid) organization.
 * Mount with the plain `requireAuth`.
 *
 * The RevenueCat webhook is the exception: it is a server-to-server callback
 * authenticated by its own shared secret rather than a user session, so it is
 * mounted without `requireAuth`.
 */
export function createBillingRouter(deps: OrganizationsRouterDeps) {
  const billingRouter = new Hono<SessionEnv>();

  billingRouter.route("/", createOrganizationBillingRoute(deps));
  billingRouter.route("/", createRevenueCatWebhookRoute(deps.runtime));

  return billingRouter;
}
