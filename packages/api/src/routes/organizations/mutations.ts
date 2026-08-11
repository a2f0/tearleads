import {
  createOrganizationGroupOperation,
  deleteOrganizationGroupOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type {
  CreateOrganizationGroupResponse,
  DeleteOrganizationGroupResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  createOrganizationGroup,
  deleteOrganizationGroup,
} from "../../services/organizations/orgManager";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import {
  type OrganizationsRouterDeps,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationMutationsRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    createOrganizationGroupOperation.method,
    operationRoutePath(createOrganizationGroupOperation),
    requireAuth,
    jsonRequestValidator(createOrganizationGroupOperation.body),
    pathParamsValidator(
      createOrganizationGroupOperation.params,
      "Invalid organizationId",
    ),
    async (c) => {
      const { organizationId } = c.req.valid("param");

      try {
        return c.json<CreateOrganizationGroupResponse>(
          await createOrganizationGroup(
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

  route.on(
    deleteOrganizationGroupOperation.method,
    operationRoutePath(deleteOrganizationGroupOperation),
    requireAuth,
    pathParamsValidator(
      deleteOrganizationGroupOperation.params,
      "Invalid organization group route",
    ),
    async (c) => {
      const { groupId, organizationId } = c.req.valid("param");

      try {
        return c.json<DeleteOrganizationGroupResponse>(
          await deleteOrganizationGroup(
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
