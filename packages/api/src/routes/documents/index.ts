import { createLoroRouter } from "@tearleads/loro/server";
import {
  isCommitDocumentChangeRequest,
  isStageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobResponse,
  CommitDocumentChangeResponse,
  ListDocumentAttachmentsResponse,
  StageBlobResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import {
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "../../middleware/session";
import {
  CommitDocumentChangeError,
  commitDocumentChange,
} from "../../services/documents/commitDocumentChange";
import { createDocumentSyncStore } from "../../services/documents/documentSyncStore";
import { GetBlobError, getBlob } from "../../services/documents/getBlob";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "../../services/documents/listDocumentAttachments";
import { StageBlobError, stageBlob } from "../../services/documents/stageBlob";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "../../services/runtime";
import type { SessionData } from "../../validators/session";

interface DocumentsRouterDeps {
  readonly publish?: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

type DocumentsRouteApp = ReturnType<typeof createLoroRouter<SessionData>>;

function addStageBlobRoute(
  documentsRouter: DocumentsRouteApp,
  requireAuth: MiddlewareHandler<SessionEnv>,
  runtime: ApiServiceRuntime,
) {
  documentsRouter.post(
    "/blobs/stage",
    requireAuth,
    validator("json", (value, c) => {
      if (!isStageBlobRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<StageBlobResponse>(
          await stageBlob(runtime, {
            ...c.req.valid("json"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof StageBlobError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

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

  documentsRouter.get("/blobs/:blobId", requireAuth, async (c) => {
    const blobId = c.req.param("blobId");
    const session = c.get("session");

    try {
      return c.json<BlobResponse>(
        await getBlob(runtime, {
          blobId,
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof GetBlobError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  });
}

export function createDocumentsRouter({
  publish,
  requireAuth = defaultRequireAuth,
  runtime = defaultApiServiceRuntime,
}: DocumentsRouterDeps = {}) {
  const publishEvent =
    publish ??
    ((event: Record<string, unknown>) => runtime.eventPublisher.publish(event));
  const documentsRouter = createLoroRouter({
    store: createDocumentSyncStore(runtime),
    publish: publishEvent,
    requireAuth,
  });

  addStageBlobRoute(documentsRouter, requireAuth, runtime);
  addCommitChangeRoute(documentsRouter, publishEvent, requireAuth, runtime);
  addDocumentReadRoutes(documentsRouter, requireAuth, runtime);

  return documentsRouter;
}
