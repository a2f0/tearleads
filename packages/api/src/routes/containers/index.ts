import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createListContainerDocumentsRoute } from "./listContainerDocuments";
import { createListContainersRoute } from "./listContainers";
import { createContainerMutationsRoute } from "./mutations";
import { createContainerWriterProjectionRoute } from "./writerProjection";

interface ContainersRouterDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createContainersRouter({
  requireAuth,
  runtime,
}: ContainersRouterDeps) {
  const containersRouter = new Hono();
  const routeDeps = { requireAuth, runtime };

  containersRouter.route("/", createListContainerDocumentsRoute(routeDeps));
  containersRouter.route("/", createListContainersRoute(routeDeps));
  containersRouter.route("/", createContainerMutationsRoute(routeDeps));
  containersRouter.route("/", createContainerWriterProjectionRoute(routeDeps));

  return containersRouter;
}
