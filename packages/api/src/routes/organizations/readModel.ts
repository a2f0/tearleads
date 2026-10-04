import {
  getOrganizationReadModelOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { OrganizationReadModelResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getOrganizationReadModel } from "../../services/organizations/orgManager";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import {
  type OrganizationsRouterDeps,
  toOrganizationPresentationErrorResponse,
} from "./shared";

export function createOrganizationReadModelRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    getOrganizationReadModelOperation.method,
    operationRoutePath(getOrganizationReadModelOperation),
    requireAuth,
    pathParamsValidator(
      getOrganizationReadModelOperation.params,
      "Invalid organizationId",
    ),
    queryParamsValidator(getOrganizationReadModelOperation.query),
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");

      try {
        c.header("Cache-Control", "private, no-store");
        return c.json<OrganizationReadModelResponse>(
          await getOrganizationReadModel(
            runtime,
            organizationId,
            c.get("session").userId,
            cursor,
          ),
        );
      } catch (error) {
        const response = toOrganizationPresentationErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );

  return route;
}
