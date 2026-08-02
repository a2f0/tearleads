import { isNativeSubscriptionStore } from "@tearleads/validators/billing";
import { type Context, Hono } from "hono";
import type { RevenueCatApiDeps } from "../../billing/revenueCatApi";
import type { SessionEnv } from "../../middleware/session";
import {
  claimNativeOrganizationSubscription,
  getOrganizationBilling,
  getOrganizationBillingHistory,
  getOrganizationBillingManagementUrl,
  OrganizationBillingProviderUnavailableError,
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
    if (error instanceof OrganizationBillingProviderUnavailableError) {
      return c.json({ error: error.message }, error.status);
    }
    const response = toOrganizationManagerErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

interface OrganizationBillingRouteDeps extends OrganizationsRouterDeps {
  readonly revenueCat?: RevenueCatApiDeps;
}

export function createOrganizationBillingRoute({
  requireAuth,
  revenueCat,
  runtime,
}: OrganizationBillingRouteDeps) {
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

  route.post(
    "/organizations/:organizationId/billing/native/:store/claim",
    requireAuth,
    (c) => {
      const store = c.req.param("store");
      if (!isNativeSubscriptionStore(store)) {
        return c.json({ error: "Invalid native subscription store" }, 400);
      }
      return respondForOrganization(c, (organizationId, sessionUserId) =>
        claimNativeOrganizationSubscription(
          runtime,
          organizationId,
          sessionUserId,
          store,
          revenueCat,
        ),
      );
    },
  );

  return route;
}
