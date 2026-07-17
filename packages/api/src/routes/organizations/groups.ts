import type { OrganizationGroupMembersResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { listOrganizationGroupMembers } from "../../services/organizations/orgManager";
import {
  type OrganizationsRouterDeps,
  parseGroupId,
  parseOrganizationId,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationGroupsRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.get(
    "/organizations/:organizationId/groups/:groupId/members",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      const groupId = parseGroupId(c.req.param("groupId"));
      if (!organizationId || !groupId) {
        return c.json({ error: "Invalid organization group route" }, 400);
      }

      try {
        return c.json<OrganizationGroupMembersResponse>(
          await listOrganizationGroupMembers(
            runtime,
            organizationId,
            groupId,
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
