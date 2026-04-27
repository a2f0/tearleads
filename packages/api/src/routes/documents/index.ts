import type { ListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "../../services/documents/listDocumentAttachments";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createDocumentV2MutationsRoute } from "./v2Mutations";

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
    createDocumentV2MutationsRoute({ publish, requireAuth, runtime }),
  );

  return documentsRouter;
}
