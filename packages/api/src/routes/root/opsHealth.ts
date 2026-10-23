import {
  getRootOpsHealthReportOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { RootOpsHealthReportResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getOpsHealthReport } from "../../services/root/opsHealth";
import { auditRootRequest, type RootRouterDeps } from "./shared";

export function createRootOpsHealthRoute({
  requireAuth,
  requireRoot,
  runtime,
}: RootRouterDeps) {
  const route = new Hono<SessionEnv>();
  route.on(
    getRootOpsHealthReportOperation.method,
    operationRoutePath(getRootOpsHealthReportOperation),
    requireAuth,
    requireRoot,
    async (c) => {
      await auditRootRequest(c, runtime, {
        action: getRootOpsHealthReportOperation.id,
      });
      return c.json<RootOpsHealthReportResponse>(
        await getOpsHealthReport(runtime),
      );
    },
  );
  return route;
}
