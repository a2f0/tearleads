import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createGetBlobRoute } from "./getBlob";
import { createStageBlobRoute } from "./stageBlob";
import { createBlobV2MutationsRoute } from "./v2Mutations";

interface BlobsRouterDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createBlobsRouter({ requireAuth, runtime }: BlobsRouterDeps) {
  const blobsRouter = new Hono();
  const routeDeps = { requireAuth, runtime };

  blobsRouter.route("/", createStageBlobRoute(routeDeps));
  blobsRouter.route("/", createBlobV2MutationsRoute(routeDeps));
  blobsRouter.route("/", createGetBlobRoute(routeDeps));

  return blobsRouter;
}
