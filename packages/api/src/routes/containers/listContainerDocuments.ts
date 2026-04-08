import type { ListContainerDocumentsResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { requireAuth } from "../../middleware/session";
import {
  ListContainerDocumentsError,
  listContainerDocuments,
} from "../../services/containers/listContainerDocuments";
import { defaultApiServiceRuntime } from "../../services/runtime";

export const listContainerDocumentsRoute = new Hono();

listContainerDocumentsRoute.get(
  "/containers/:containerId/documents",
  requireAuth,
  async (c) => {
    const session = c.get("session");
    const containerId = c.req.param("containerId");

    try {
      return c.json<ListContainerDocumentsResponse>(
        await listContainerDocuments(
          defaultApiServiceRuntime,
          containerId,
          session.userId,
        ),
      );
    } catch (error) {
      if (error instanceof ListContainerDocumentsError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
