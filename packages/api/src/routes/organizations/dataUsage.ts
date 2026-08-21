import {
  getOrganizationDataUsageOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { OrganizationDataUsageResponse } from "@symcrypt/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getOrganizationDataUsage } from "../../services/organizations/orgManager";
import { pathParamsValidator } from "../../validators/pathParams";
import {
  type OrganizationsRouterDeps,
  toOrganizationManagerErrorResponse,
} from "./shared";

export function createOrganizationDataUsageRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    getOrganizationDataUsageOperation.method,
    operationRoutePath(getOrganizationDataUsageOperation),
    requireAuth,
    pathParamsValidator(
      getOrganizationDataUsageOperation.params,
      "Invalid organizationId",
    ),
    async (c) => {
      const { organizationId } = c.req.valid("param");

      try {
        return c.json<OrganizationDataUsageResponse>(
          await getOrganizationDataUsage(
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
    },
  );

  return route;
}
