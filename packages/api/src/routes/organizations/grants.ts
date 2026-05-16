import type { OrganizationContainerGrantsResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { listOrganizationContainerGrants } from "../../services/organizations/orgManager";
import {
  type OrganizationsRouterDeps,
  parseOrganizationId,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationGrantsRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.get("/organizations/:organizationId/grants", requireAuth, async (c) => {
    const organizationId = parseOrganizationId(c.req.param("organizationId"));
    if (!organizationId) {
      return c.json({ error: "Invalid organizationId" }, 400);
    }

    try {
      return c.json<OrganizationContainerGrantsResponse>(
        await listOrganizationContainerGrants(
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
  });

  return route;
}
