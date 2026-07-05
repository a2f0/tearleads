import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { OrganizationsRouterDeps } from "../organizations/shared";
import { createOrganizationBillingRoute } from "./organizationBilling";

/**
 * Billing routes are authed but NOT behind the paid sync gate: an admin must be
 * able to read billing and start a trial on a `local` (unpaid) organization.
 * Mount with the plain `requireAuth`.
 */
export function createBillingRouter(deps: OrganizationsRouterDeps) {
  const billingRouter = new Hono<SessionEnv>();

  billingRouter.route("/", createOrganizationBillingRoute(deps));

  return billingRouter;
}
