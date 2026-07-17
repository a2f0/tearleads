import type { OrganizationReadModelResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getOrganizationReadModel } from "../../services/organizations/orgManager";
import {
  type OrganizationsRouterDeps,
  parseOrganizationId,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationReadModelRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.get(
    "/organizations/:organizationId/read-model",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      if (!organizationId) {
        return c.json({ error: "Invalid organizationId" }, 400);
      }

      try {
        c.header("Cache-Control", "private, no-store");
        return c.json<OrganizationReadModelResponse>(
          await getOrganizationReadModel(
            runtime,
            organizationId,
            c.get("session").userId,
            c.req.query("cursor"),
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
