import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getContainerKekLog } from "../../services/containers/kekLog";
import { ContainerWriterProjectionError } from "../../services/containers/writerProjection";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ContainerKekLogRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createContainerKekLogRoute({
  requireAuth,
  runtime,
}: ContainerKekLogRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.get("/containers/:containerId/kek-log", requireAuth, async (c) => {
    const session = c.get("session");

    try {
      return c.json<ContainerKekLogResponse>(
        await getContainerKekLog(runtime, {
          containerId: c.req.param("containerId"),
          includeKeyrings: c.req.query("include") === "keyrings",
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof ContainerWriterProjectionError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  });

  return route;
}
