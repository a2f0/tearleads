import {
  getRootOrganizationDataUsageOperation,
  listRootDataUsageReportOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  getOrganizationDataUsage,
  listDataUsageReport,
} from "../../services/root/dataUsage";
import { RootOrganizationError } from "../../services/root/organizations";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";
import type { RootRouterDeps } from "./shared";

export function createRootDataUsageRoute({
  requireAuth,
  requireRoot,
  runtime,
}: RootRouterDeps) {
  const route = new Hono<SessionEnv>();
  route.on(
    getRootOrganizationDataUsageOperation.method,
    operationRoutePath(getRootOrganizationDataUsageOperation),
    requireAuth,
    requireRoot,
    pathParamsValidator(
      getRootOrganizationDataUsageOperation.params,
      "Invalid organizationId",
    ),
    async (c) => {
      try {
        return c.json(
          await getOrganizationDataUsage(
            runtime,
            c.req.valid("param").organizationId,
          ),
        );
      } catch (error) {
        return respondToStatusError(c, error, RootOrganizationError);
      }
    },
  );
  route.on(
    listRootDataUsageReportOperation.method,
    operationRoutePath(listRootDataUsageReportOperation),
    requireAuth,
    requireRoot,
    queryParamsValidator(
      listRootDataUsageReportOperation.query,
      "Invalid query",
    ),
    async (c) => {
      try {
        return c.json(await listDataUsageReport(runtime, c.req.valid("query")));
      } catch (error) {
        return respondToStatusError(c, error, RootOrganizationError);
      }
    },
  );
  return route;
}
