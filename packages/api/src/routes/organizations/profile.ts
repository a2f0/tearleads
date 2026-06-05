import { isUpdateOrganizationProfileRequest } from "@tearleads/validators/request";
import type { OrganizationProfileResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { updateOrganizationProfile } from "../../services/organizations/orgManager";
import {
  type OrganizationsRouterDeps,
  parseOrganizationId,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationProfileRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.put(
    "/organizations/:organizationId/profile",
    requireAuth,
    validator("json", (value, c) => {
      if (!isUpdateOrganizationProfileRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      if (!organizationId) {
        return c.json({ error: "Invalid organizationId" }, 400);
      }

      try {
        return c.json<OrganizationProfileResponse>(
          await updateOrganizationProfile(
            runtime,
            organizationId,
            c.get("session").userId,
            c.req.valid("json"),
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
