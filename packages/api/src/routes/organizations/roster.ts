import { isUpdateOrganizationRosterEntryRequest } from "@tearleads/validators/request";
import type { OrganizationDirectoryUserResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { updateOrganizationRosterEntry } from "../../services/organizations/orgManager";
import {
  type OrganizationsRouterDeps,
  parseOrganizationId,
  parseUserId,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationRosterRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.put(
    "/organizations/:organizationId/roster/:userId",
    requireAuth,
    validator("json", (value, c) => {
      if (!isUpdateOrganizationRosterEntryRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      const userId = parseUserId(c.req.param("userId"));
      if (!organizationId || !userId) {
        return c.json({ error: "Invalid roster route" }, 400);
      }

      try {
        return c.json<OrganizationDirectoryUserResponse>(
          await updateOrganizationRosterEntry(
            runtime,
            organizationId,
            userId,
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
