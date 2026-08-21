import {
  operationRoutePath,
  updateOrganizationRosterEntryOperation,
} from "@symcrypt/validators/operation";
import type { OrganizationDirectoryUserResponse } from "@symcrypt/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { updateOrganizationRosterEntry } from "../../services/organizations/orgManager";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import {
  type OrganizationsRouterDeps,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationRosterRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    updateOrganizationRosterEntryOperation.method,
    operationRoutePath(updateOrganizationRosterEntryOperation),
    requireAuth,
    jsonRequestValidator(updateOrganizationRosterEntryOperation.body),
    pathParamsValidator(
      updateOrganizationRosterEntryOperation.params,
      "Invalid roster route",
    ),
    async (c) => {
      const { organizationId, userId } = c.req.valid("param");

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
