import { createLoroRouter } from "@tearleads/loro/server";
import { isCommitDocumentChangeRequest } from "@tearleads/validators/request";
import type {
  CommitDocumentChangeResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  CommitDocumentChangeError,
  commitDocumentChange,
} from "../../services/documents/commitDocumentChange";
import { createDocumentSyncStore } from "../../services/documents/documentSyncStore";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "../../services/documents/listDocumentAttachments";
import type { ApiServiceRuntime } from "../../services/runtime";
import type { SessionData } from "../../validators/session";
import { createDocumentV2MutationsRoute } from "./v2Mutations";

interface DocumentsRouterDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

type DocumentsRouteApp = ReturnType<typeof createLoroRouter<SessionData>>;

function addCommitChangeRoute(
  documentsRouter: DocumentsRouteApp,
  publish: (event: Record<string, unknown>) => Promise<void>,
  requireAuth: MiddlewareHandler<SessionEnv>,
  runtime: ApiServiceRuntime,
) {
  documentsRouter.post(
    "/documents/:documentId/commit-change",
    requireAuth,
    validator("json", (value, c) => {
      if (!isCommitDocumentChangeRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const documentId = c.req.param("documentId");
      const session = c.get("session");
      const request = c.req.valid("json");

      try {
        const result = await commitDocumentChange(runtime, {
          documentId,
          request,
          session,
        });

        if (result.acceptedOutgoingUpdateIds.length > 0) {
          await publish({
            type: "document_update_created",
            documentId,
            updateIds: result.acceptedOutgoingUpdateIds,
          });
        }

        return c.json<CommitDocumentChangeResponse>(result);
      } catch (error) {
        if (error instanceof CommitDocumentChangeError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

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
  const documentsRouter = createLoroRouter({
    store: createDocumentSyncStore(runtime),
    publish,
    requireAuth,
  });

  addCommitChangeRoute(documentsRouter, publish, requireAuth, runtime);
  addDocumentReadRoutes(documentsRouter, requireAuth, runtime);
  documentsRouter.route(
    "/",
    createDocumentV2MutationsRoute({ publish, requireAuth, runtime }),
  );

  return documentsRouter;
}
