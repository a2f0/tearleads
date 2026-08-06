import {
  listOrganizationGroupMembersOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { OrganizationGroupMembersResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { listOrganizationGroupMembers } from "../../services/organizations/orgManager";
import { pathParamsValidator } from "../../validators/pathParams";
import {
  type OrganizationsRouterDeps,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationGroupsRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    listOrganizationGroupMembersOperation.method,
    operationRoutePath(listOrganizationGroupMembersOperation),
    requireAuth,
    pathParamsValidator(
      listOrganizationGroupMembersOperation.params,
      "Invalid organization group route",
    ),
    async (c) => {
      const { groupId, organizationId } = c.req.valid("param");

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
