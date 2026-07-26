import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { DOCUMENT_PROJECTION_ERROR_CODES } from "@tearleads/validators/response";
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

/**
 * A container-level 404 must not become this route's 404: clients treat a
 * document-route 404 as upstream document deletion and answer with a
 * destructive local wipe, so the caller remaps it to 409. The 409 classes
 * carry a code distinguishing a vanished container from a keying conflict so
 * support reports can tell which dependency refused; other statuses (e.g.
 * 403) keep their plain shape.
 */
function containerProjectionErrorBody(error: ContainerWriterProjectionError): {
  code?: string;
  error: string;
} {
  const code =
    error.status === 404
      ? DOCUMENT_PROJECTION_ERROR_CODES.containerUnavailable
      : error.status === 409
        ? DOCUMENT_PROJECTION_ERROR_CODES.containerConflict
        : undefined;
  return code === undefined
    ? { error: error.message }
    : { code, error: error.message };
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
          return c.json(
            error.code === undefined
              ? { error: error.message }
              : { code: error.code, error: error.message },
            error.status,
          );
        }
        if (error instanceof ContainerWriterProjectionError) {
          return c.json(
            containerProjectionErrorBody(error),
            error.status === 404 ? 409 : error.status,
          );
        }

        throw error;
      }
    },
  );

  return route;
}
