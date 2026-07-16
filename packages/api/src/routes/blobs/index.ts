import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createGetBlobRoute } from "./getBlob";
import { createMultipartBlobStageRoute } from "./multipartStage";
import { createBlobMutationsRoute } from "./mutations";

interface BlobsRouterDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createBlobsRouter({ requireAuth, runtime }: BlobsRouterDeps) {
  const blobsRouter = new Hono();
  const routeDeps = { requireAuth, runtime };

  blobsRouter.route("/", createMultipartBlobStageRoute(routeDeps));
  blobsRouter.route("/", createBlobMutationsRoute(routeDeps));
  blobsRouter.route("/", createGetBlobRoute(routeDeps));

  return blobsRouter;
}
