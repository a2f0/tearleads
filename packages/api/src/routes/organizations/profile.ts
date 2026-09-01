import {
  operationRoutePath,
  updateOrganizationProfileOperation,
} from "@tearleads/validators/operation";
import type { OrganizationProfileResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { updateOrganizationProfile } from "../../services/organizations/orgManager";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import {
  type OrganizationsRouterDeps,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationProfileRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    updateOrganizationProfileOperation.method,
    operationRoutePath(updateOrganizationProfileOperation),
    requireAuth,
    jsonRequestValidator(updateOrganizationProfileOperation.body),
    pathParamsValidator(
      updateOrganizationProfileOperation.params,
      "Invalid organizationId",
    ),
    async (c) => {
      const { organizationId } = c.req.valid("param");

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
