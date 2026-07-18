import type {
  OrganizationBillingHistoryResponse,
  OrganizationBillingResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  getOrganizationBilling,
  getOrganizationBillingHistory,
  startOrganizationTrial,
} from "../../services/billing/organizationBilling";
import {
  type OrganizationsRouterDeps,
  parseOrganizationId,
  toOrganizationManagerErrorResponse,
} from "../organizations/shared";

export function createOrganizationBillingRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.get(
    "/organizations/:organizationId/billing",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      if (!organizationId) {
        return c.json({ error: "Invalid organizationId" }, 400);
      }

      try {
        return c.json<OrganizationBillingResponse>(
          await getOrganizationBilling(
            runtime,
            organizationId,
            c.get("session").userId,
          ),
        );
      } catch (error) {
        const response = toOrganizationManagerErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );

  route.get(
    "/organizations/:organizationId/billing/history",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      if (!organizationId) {
        return c.json({ error: "Invalid organizationId" }, 400);
      }

      try {
        return c.json<OrganizationBillingHistoryResponse>(
          await getOrganizationBillingHistory(
            runtime,
            organizationId,
            c.get("session").userId,
          ),
        );
      } catch (error) {
        const response = toOrganizationManagerErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );

  route.post(
    "/organizations/:organizationId/billing/trial",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      if (!organizationId) {
        return c.json({ error: "Invalid organizationId" }, 400);
      }

      try {
        return c.json<OrganizationBillingResponse>(
          await startOrganizationTrial(
            runtime,
            organizationId,
            c.get("session").userId,
          ),
        );
      } catch (error) {
        const response = toOrganizationManagerErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );

  return route;
}
