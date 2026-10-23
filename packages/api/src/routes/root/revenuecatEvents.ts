import {
  listRootOrganizationRevenuecatEventsOperation,
  listRootRevenuecatEventsReportOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type {
  RootOrganizationRevenuecatEventsResponse,
  RootRevenuecatEventsReportResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { RootOrganizationError } from "../../services/root/organizations";
import {
  listOrganizationRevenuecatEvents,
  listRevenuecatEventsReport,
} from "../../services/root/revenuecatEvents";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";
import { auditRootRequest, type RootRouterDeps } from "./shared";

export function createRootRevenuecatEventsRoute({
  requireAuth,
  requireRoot,
  runtime,
}: RootRouterDeps) {
  const route = new Hono<SessionEnv>();
  route.on(
    listRootOrganizationRevenuecatEventsOperation.method,
    operationRoutePath(listRootOrganizationRevenuecatEventsOperation),
    requireAuth,
    requireRoot,
    pathParamsValidator(
      listRootOrganizationRevenuecatEventsOperation.params,
      "Invalid organizationId",
    ),
    queryParamsValidator(
      listRootOrganizationRevenuecatEventsOperation.query,
      "Invalid query",
    ),
    async (c) => {
      try {
        const { organizationId } = c.req.valid("param");
        await auditRootRequest(c, runtime, {
          action: listRootOrganizationRevenuecatEventsOperation.id,
          targetOrganizationId: organizationId,
        });
        return c.json<RootOrganizationRevenuecatEventsResponse>(
          await listOrganizationRevenuecatEvents(
            runtime,
            organizationId,
            c.req.valid("query"),
          ),
        );
      } catch (error) {
        return respondToStatusError(c, error, RootOrganizationError);
      }
    },
  );
  route.on(
    listRootRevenuecatEventsReportOperation.method,
    operationRoutePath(listRootRevenuecatEventsReportOperation),
    requireAuth,
    requireRoot,
    queryParamsValidator(
      listRootRevenuecatEventsReportOperation.query,
      "Invalid query",
    ),
    async (c) => {
      try {
        const query = c.req.valid("query");
        await auditRootRequest(c, runtime, {
          action: listRootRevenuecatEventsReportOperation.id,
          filters: { disposition: query.disposition },
        });
        return c.json<RootRevenuecatEventsReportResponse>(
          await listRevenuecatEventsReport(runtime, query),
        );
      } catch (error) {
        return respondToStatusError(c, error, RootOrganizationError);
      }
    },
  );
  return route;
}
