import { isShareContainerRequest } from "@tearleads/validators/request";
import type { ShareContainerResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  ShareContainerError,
  shareContainer,
} from "../../services/containers/shareContainer";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ShareContainerRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createShareContainerRoute({
  requireAuth,
  runtime,
}: ShareContainerRouteDeps) {
  const shareContainerRoute = new Hono();

  shareContainerRoute.post(
    "/containers/:containerId/share",
    requireAuth,
    validator("json", (value, c) => {
      if (!isShareContainerRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const session = c.get("session");
      const containerId = c.req.param("containerId");

      try {
        return c.json<ShareContainerResponse>(
          await shareContainer(runtime, {
            ...c.req.valid("json"),
            containerId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof ShareContainerError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return shareContainerRoute;
}
