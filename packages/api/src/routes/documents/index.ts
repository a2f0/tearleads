import type {
  DocumentEditAttributionResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  DocumentEditAttributionError,
  documentEditAttribution,
} from "../../services/documents/documentEditAttribution";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "../../services/documents/listDocumentAttachments";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createDocumentMutationsRoute } from "./mutations";
import { createDocumentWriterProjectionRoute } from "./writerProjection";

interface DocumentsRouterDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

type DocumentsRouteApp = Hono<SessionEnv>;

function addDocumentReadRoutes(
  documentsRouter: DocumentsRouteApp,
  requireAuth: MiddlewareHandler<SessionEnv>,
  runtime: ApiServiceRuntime,
) {
  documentsRouter.get(
    "/documents/:documentId/attachments",
    requireAuth,
    async (c) => {
      const documentId = c.req.param("documentId");
      const session = c.get("session");

      try {
        return c.json<ListDocumentAttachmentsResponse>(
          await listDocumentAttachments(runtime, {
            documentId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof ListDocumentAttachmentsError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  documentsRouter.get(
    "/documents/:documentId/attribution",
    requireAuth,
    async (c) => {
      const documentId = c.req.param("documentId");
      const session = c.get("session");

      try {
        return c.json<DocumentEditAttributionResponse>(
          await documentEditAttribution(runtime, {
            documentId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof DocumentEditAttributionError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

export function createDocumentsRouter({
  publish,
  requireAuth,
  runtime,
}: DocumentsRouterDeps) {
  const documentsRouter = new Hono<SessionEnv>();

  addDocumentReadRoutes(documentsRouter, requireAuth, runtime);
  documentsRouter.route(
    "/",
    createDocumentMutationsRoute({ publish, requireAuth, runtime }),
  );
  documentsRouter.route(
    "/",
    createDocumentWriterProjectionRoute({ requireAuth, runtime }),
  );

  return documentsRouter;
}
