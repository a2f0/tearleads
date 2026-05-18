import type { OrganizationUserDetailResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getOrganizationUserDetail } from "../../services/organizations/orgManager";
import {
  type OrganizationsRouterDeps,
  parseOrganizationId,
  parseUserId,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationUsersRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.get(
    "/organizations/:organizationId/users/:userId/detail",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      const userId = parseUserId(c.req.param("userId"));
      if (!organizationId || !userId) {
        return c.json({ error: "Invalid organization user route" }, 400);
      }

      try {
        return c.json<OrganizationUserDetailResponse>(
          await getOrganizationUserDetail(
            runtime,
            organizationId,
            userId,
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
