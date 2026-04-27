import type { ContainerV2WriterProjectionResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ContainerV2WriterProjectionError,
  getContainerV2WriterProjection,
} from "../../services/containers/v2WriterProjection";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ContainerV2WriterProjectionRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createContainerV2WriterProjectionRoute({
  requireAuth,
  runtime,
}: ContainerV2WriterProjectionRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.get(
    "/v2/containers/:containerId/writer-projection",
    requireAuth,
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<ContainerV2WriterProjectionResponse>(
          await getContainerV2WriterProjection(runtime, {
            containerId: c.req.param("containerId"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof ContainerV2WriterProjectionError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
