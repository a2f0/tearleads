import type { ListContainerDocumentsResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "../../middleware/session";
import {
  ListContainerDocumentsError,
  listContainerDocuments,
} from "../../services/containers/listContainerDocuments";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "../../services/runtime";

interface ListContainerDocumentsRouteDeps {
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createListContainerDocumentsRoute({
  requireAuth = defaultRequireAuth,
  runtime = defaultApiServiceRuntime,
}: ListContainerDocumentsRouteDeps = {}) {
  const listContainerDocumentsRoute = new Hono();

  listContainerDocumentsRoute.get(
    "/containers/:containerId/documents",
    requireAuth,
    async (c) => {
      const session = c.get("session");
      const containerId = c.req.param("containerId");

      try {
        return c.json<ListContainerDocumentsResponse>(
          await listContainerDocuments(runtime, containerId, session.userId),
        );
      } catch (error) {
        if (error instanceof ListContainerDocumentsError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return listContainerDocumentsRoute;
}
