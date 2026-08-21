import {
  getContainerWriterProjectionOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ContainerWriterProjectionError,
  getContainerWriterProjection,
} from "../../services/containers/writerProjection";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

interface ContainerWriterProjectionRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createContainerWriterProjectionRoute({
  requireAuth,
  runtime,
}: ContainerWriterProjectionRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    getContainerWriterProjectionOperation.method,
    operationRoutePath(getContainerWriterProjectionOperation),
    requireAuth,
    pathParamsValidator(getContainerWriterProjectionOperation.params),
    async (c) => {
      const { containerId } = c.req.valid("param");
      const session = c.get("session");

      try {
        return c.json<ContainerWriterProjectionResponse>(
          await getContainerWriterProjection(runtime, {
            containerId,
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
