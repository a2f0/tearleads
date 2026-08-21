import {
  getContainerKekLogOperation,
  normalizeContainerKekLogEpochQuery,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { ContainerKekLogResponse } from "@symcrypt/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getContainerKekLog } from "../../services/containers/kekLog";
import { ContainerWriterProjectionError } from "../../services/containers/writerProjection";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";

interface ContainerKekLogRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createContainerKekLogRoute({
  requireAuth,
  runtime,
}: ContainerKekLogRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    getContainerKekLogOperation.method,
    operationRoutePath(getContainerKekLogOperation),
    requireAuth,
    pathParamsValidator(getContainerKekLogOperation.params),
    queryParamsValidator(getContainerKekLogOperation.query),
    async (c) => {
      const session = c.get("session");
      const { containerId } = c.req.valid("param");
      const { afterKeyEpoch, keyringForEpoch } = c.req.valid("query");

      try {
        return c.json<ContainerKekLogResponse>(
          await getContainerKekLog(runtime, {
            afterKeyEpoch: normalizeContainerKekLogEpochQuery(afterKeyEpoch),
            containerId,
            keyringForEpoch:
              normalizeContainerKekLogEpochQuery(keyringForEpoch),
            userId: session.userId,
          }),
        );
      } catch (error) {
        return respondToStatusError(c, error, ContainerWriterProjectionError);
      }
    },
  );

  return route;
}
