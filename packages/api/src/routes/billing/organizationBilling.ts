import { type Context, Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  getOrganizationBilling,
  getOrganizationBillingHistory,
  getOrganizationBillingManagementUrl,
  startOrganizationTrial,
} from "../../services/billing/organizationBilling";
import {
  type OrganizationsRouterDeps,
  parseOrganizationId,
  toOrganizationManagerErrorResponse,
} from "../organizations/shared";

/**
 * Runs an organization-scoped billing handler: validates the `organizationId`,
 * invokes the service with it and the session user, then maps an
 * `OrganizationManagerError` to its HTTP response and rethrows anything else to
 * the central error handler. Keeps each billing route a single delegation.
 */
async function respondForOrganization<T extends object>(
  c: Context<SessionEnv>,
  handle: (organizationId: string, sessionUserId: string) => Promise<T>,
): Promise<Response> {
  const organizationId = parseOrganizationId(c.req.param("organizationId"));
  if (!organizationId) {
    return c.json({ error: "Invalid organizationId" }, 400);
  }
  try {
    return c.json(await handle(organizationId, c.get("session").userId));
  } catch (error) {
    const response = toOrganizationManagerErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export function createOrganizationBillingRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.get("/organizations/:organizationId/billing", requireAuth, (c) =>
    respondForOrganization(c, (organizationId, sessionUserId) =>
      getOrganizationBilling(runtime, organizationId, sessionUserId),
    ),
  );

  route.get(
    "/organizations/:organizationId/billing/history",
    requireAuth,
    (c) =>
      respondForOrganization(c, (organizationId, sessionUserId) =>
        getOrganizationBillingHistory(runtime, organizationId, sessionUserId),
      ),
  );

  route.get(
    "/organizations/:organizationId/billing/management-url",
    requireAuth,
    (c) =>
      respondForOrganization(c, (organizationId, sessionUserId) =>
        getOrganizationBillingManagementUrl(
          runtime,
          organizationId,
          sessionUserId,
        ),
      ),
  );

  route.post("/organizations/:organizationId/billing/trial", requireAuth, (c) =>
    respondForOrganization(c, (organizationId, sessionUserId) =>
      startOrganizationTrial(runtime, organizationId, sessionUserId),
    ),
  );

  return route;
}
