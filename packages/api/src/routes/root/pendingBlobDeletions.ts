import {
  listRootPendingBlobDeletionsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  listRootPendingBlobDeletions,
  PendingBlobDeletionsError,
} from "../../services/blobs/pendingDeletions";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";
import { auditRootRequest, type RootRouterDeps } from "./shared";

export function createRootPendingBlobDeletionsRoute({
  requireAuth,
  requireRoot,
  runtime,
}: RootRouterDeps) {
  const route = new Hono<SessionEnv>();
  route.on(
    listRootPendingBlobDeletionsOperation.method,
    operationRoutePath(listRootPendingBlobDeletionsOperation),
    requireAuth,
    requireRoot,
    queryParamsValidator(
      listRootPendingBlobDeletionsOperation.query,
      "Invalid query",
    ),
    async (c) => {
      try {
        const query = c.req.valid("query");
        await auditRootRequest(c, runtime, {
          action: listRootPendingBlobDeletionsOperation.id,
          filters: { organizationId: query.organizationId },
          ...(query.organizationId === undefined
            ? {}
            : { targetOrganizationId: query.organizationId }),
        });
        return c.json(await listRootPendingBlobDeletions(runtime, query));
      } catch (error) {
        return respondToStatusError(c, error, PendingBlobDeletionsError);
      }
    },
  );
  return route;
}
