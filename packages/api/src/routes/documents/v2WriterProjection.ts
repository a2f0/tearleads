import type { DocumentV2WriterProjectionResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { ContainerV2WriterProjectionError } from "../../services/containers/v2WriterProjection";
import {
  DocumentV2WriterProjectionError,
  getDocumentV2WriterProjection,
} from "../../services/documents/v2WriterProjection";
import type { ApiServiceRuntime } from "../../services/runtime";

interface DocumentV2WriterProjectionRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createDocumentV2WriterProjectionRoute({
  requireAuth,
  runtime,
}: DocumentV2WriterProjectionRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.get(
    "/v2/documents/:documentId/writer-projection",
    requireAuth,
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<DocumentV2WriterProjectionResponse>(
          await getDocumentV2WriterProjection(runtime, {
            documentId: c.req.param("documentId"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof DocumentV2WriterProjectionError) {
          return c.json({ error: error.message }, error.status);
        }
        if (error instanceof ContainerV2WriterProjectionError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
