import {
  getContainerWriterProjectionOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ContainerWriterProjectionError,
  getContainerWriterProjection,
} from "../../services/containers/writerProjection";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";

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
        if (error instanceof ContainerWriterProjectionError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
