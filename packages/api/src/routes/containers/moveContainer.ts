import { isMoveContainerRequest } from "@tearleads/validators/request";
import type { MoveContainerResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { requireAuth } from "../../middleware/session";
import {
  MoveContainerError,
  moveContainer,
} from "../../services/containers/moveContainer";
import { defaultApiServiceRuntime } from "../../services/runtime";

export const moveContainerRoute = new Hono();

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
        await moveContainer(defaultApiServiceRuntime, {
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
