import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createContainerKekLogRoute } from "./kekLog";
import { createListContainerDocumentLanesRoute } from "./listContainerDocumentLanes";
import { createListContainerParentLanesRoute } from "./listContainerParentLanes";
import { createContainerMutationsRoute } from "./mutations";
import { createContainerReciteRoute } from "./recite";
import { createContainerReplacementAuthorizationsRoute } from "./replacementAuthorizations";
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
    createContainerReplacementAuthorizationsRoute({ requireAuth, runtime }),
  );

  containersRouter.route(
    "/",
    createListContainerDocumentLanesRoute({ requireAuth, runtime }),
  );
  containersRouter.route(
    "/",
    createListContainerParentLanesRoute({ requireAuth, runtime }),
  );
  containersRouter.route("/", createContainerMutationsRoute(routeDeps));
  containersRouter.route("/", createContainerReciteRoute(routeDeps));
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
