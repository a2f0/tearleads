import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createContainerKekLogRoute } from "./kekLog";
import { createListContainerDocumentsRoute } from "./listContainerDocuments";
import { createListContainerParentLanesRoute } from "./listContainerParentLanes";
import { createContainerMutationsRoute } from "./mutations";
import { createContainerWriterProjectionRoute } from "./writerProjection";

interface ContainersRouterDeps {
  readonly publish: (event: PublishedRealtimeEvent) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createContainersRouter({
  publish,
  requireAuth,
  runtime,
}: ContainersRouterDeps) {
  const containersRouter = new Hono();
  const routeDeps = { publish, requireAuth, runtime };

  containersRouter.route(
    "/",
    createListContainerDocumentsRoute({ requireAuth, runtime }),
  );
  containersRouter.route(
    "/",
    createListContainerParentLanesRoute({ requireAuth, runtime }),
  );
  containersRouter.route("/", createContainerMutationsRoute(routeDeps));
  containersRouter.route(
    "/",
    createContainerWriterProjectionRoute({ requireAuth, runtime }),
  );
  containersRouter.route(
    "/",
    createContainerKekLogRoute({ requireAuth, runtime }),
  );

  return containersRouter;
}
