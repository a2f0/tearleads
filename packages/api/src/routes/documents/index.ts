import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createDocumentAttachmentsRoute } from "./attachments";
import { createDocumentAttributionRoute } from "./attribution";
import { createDocumentMutationsRoute } from "./mutations";
import { createDocumentWriterProjectionRoute } from "./writerProjection";

interface DocumentsRouterDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createDocumentsRouter({
  publish,
  requireAuth,
  runtime,
}: DocumentsRouterDeps) {
  const documentsRouter = new Hono<SessionEnv>();

  documentsRouter.route(
    "/",
    createDocumentAttachmentsRoute({ requireAuth, runtime }),
  );
  documentsRouter.route(
    "/",
    createDocumentAttributionRoute({ requireAuth, runtime }),
  );
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
