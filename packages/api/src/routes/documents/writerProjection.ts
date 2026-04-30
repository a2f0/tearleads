import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { ContainerWriterProjectionError } from "../../services/containers/writerProjection";
import {
  DocumentWriterProjectionError,
  getDocumentWriterProjection,
} from "../../services/documents/writerProjection";
import type { ApiServiceRuntime } from "../../services/runtime";

interface DocumentWriterProjectionRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createDocumentWriterProjectionRoute({
  requireAuth,
  runtime,
}: DocumentWriterProjectionRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.get(
    "/documents/:documentId/writer-projection",
    requireAuth,
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<DocumentWriterProjectionResponse>(
          await getDocumentWriterProjection(runtime, {
            documentId: c.req.param("documentId"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof DocumentWriterProjectionError) {
          return c.json({ error: error.message }, error.status);
        }
        if (error instanceof ContainerWriterProjectionError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
