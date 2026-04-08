import { isCreateContainerRequest } from "@tearleads/validators/request";
import type { CreateContainerResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { requireAuth } from "../../middleware/session";
import {
  ContainerMetadataError,
  CreateContainerError,
  createContainer,
} from "../../services/containers/createContainer";
import { defaultApiServiceRuntime } from "../../services/runtime";

export const createContainerRoute = new Hono();

createContainerRoute.post(
  "/containers",
  requireAuth,
  validator("json", (value, c) => {
    if (!isCreateContainerRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const session = c.get("session");

    try {
      return c.json<CreateContainerResponse>(
        await createContainer(defaultApiServiceRuntime, {
          ...c.req.valid("json"),
          createdByFingerprint: session.fingerprint,
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof CreateContainerError) {
        return c.json({ error: error.message }, error.status);
      }

      if (error instanceof ContainerMetadataError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
