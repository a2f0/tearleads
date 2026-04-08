import { isShareContainerRequest } from "@tearleads/validators/request";
import type { ShareContainerResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { requireAuth } from "../../middleware/session";
import {
  ShareContainerError,
  shareContainer,
} from "../../services/containers/shareContainer";
import { defaultApiServiceRuntime } from "../../services/runtime";

export const shareContainerRoute = new Hono();

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
        await shareContainer(defaultApiServiceRuntime, {
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
