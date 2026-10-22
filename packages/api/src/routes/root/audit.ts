import {
  listRootAuditEventsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { RootAuditEventsResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { listAuditEvents, RootAuditError } from "../../services/root/audit";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";
import { auditRootRequest, type RootRouterDeps } from "./shared";

export function createRootAuditRoute({
  requireAuth,
  requireRoot,
  runtime,
}: RootRouterDeps) {
  const route = new Hono<SessionEnv>();
  route.on(
    listRootAuditEventsOperation.method,
    operationRoutePath(listRootAuditEventsOperation),
    requireAuth,
    requireRoot,
    queryParamsValidator(listRootAuditEventsOperation.query, "Invalid query"),
    async (c) => {
      const { cursor, limit, subjectId } = c.req.valid("query");
      try {
        await auditRootRequest(c, runtime, {
          action: listRootAuditEventsOperation.id,
          filters: { subjectId },
        });
        return c.json<RootAuditEventsResponse>(
          await listAuditEvents(runtime, {
            cursor,
            limit: limit === undefined ? undefined : Number(limit),
            subjectId,
          }),
        );
      } catch (error) {
        return respondToStatusError(c, error, RootAuditError);
      }
    },
  );
  return route;
}
