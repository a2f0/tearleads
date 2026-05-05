import type { ListContainerDocumentsResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ListContainerDocumentsError,
  listContainerDocuments,
} from "../../services/containers/listContainerDocuments";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ListContainerDocumentsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createListContainerDocumentsRoute({
  requireAuth,
  runtime,
}: ListContainerDocumentsRouteDeps) {
  const listContainerDocumentsRoute = new Hono();

  listContainerDocumentsRoute.get(
    "/containers/:containerId/documents",
    requireAuth,
    async (c) => {
      const session = c.get("session");
      const containerId = c.req.param("containerId");
      const cursor = c.req.query("cursor");
      const limit = parseOptionalInteger(c.req.query("limit"));

      try {
        return c.json<ListContainerDocumentsResponse>(
          await listContainerDocuments(runtime, containerId, session.userId, {
            ...(cursor === undefined ? {} : { cursor }),
            ...(limit === undefined ? {} : { limit }),
          }),
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

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Number(value);
}
