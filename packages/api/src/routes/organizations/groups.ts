import type {
  ListOrganizationGroupsResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMembersResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  listOrganizationGroupContainers,
  listOrganizationGroupMembers,
  listOrganizationGroups,
} from "../../services/organizations/orgManager";
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

  route.get("/organizations/:organizationId/groups", requireAuth, async (c) => {
    const organizationId = parseOrganizationId(c.req.param("organizationId"));
    if (!organizationId) {
      return c.json({ error: "Invalid organizationId" }, 400);
    }

    try {
      return c.json<ListOrganizationGroupsResponse>(
        await listOrganizationGroups(
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

  route.get(
    "/organizations/:organizationId/groups/:groupId/containers",
    requireAuth,
    async (c) => {
      const organizationId = parseOrganizationId(c.req.param("organizationId"));
      const groupId = parseGroupId(c.req.param("groupId"));
      if (!organizationId || !groupId) {
        return c.json({ error: "Invalid organization group route" }, 400);
      }

      try {
        return c.json<OrganizationGroupContainersResponse>(
          await listOrganizationGroupContainers(
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
