import { isMoveContainerRequest } from "@tearleads/validators/request";
import type { MoveContainerResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "../../middleware/session";
import {
  MoveContainerError,
  moveContainer,
} from "../../services/containers/moveContainer";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "../../services/runtime";

interface MoveContainerRouteDeps {
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createMoveContainerRoute({
  requireAuth = defaultRequireAuth,
  runtime = defaultApiServiceRuntime,
}: MoveContainerRouteDeps = {}) {
  const moveContainerRoute = new Hono();

  moveContainerRoute.post(
    "/containers/:containerId/move",
    requireAuth,
    validator("json", (value, c) => {
      if (!isMoveContainerRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const session = c.get("session");
      const containerId = c.req.param("containerId");

      try {
        return c.json<MoveContainerResponse>(
          await moveContainer(runtime, {
            ...c.req.valid("json"),
            containerId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof MoveContainerError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return moveContainerRoute;
}
