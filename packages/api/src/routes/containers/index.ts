import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { assignIfDefined } from "../../utils/object";
import { createCreateContainerRoute } from "./createContainer";
import { createListContainerDocumentsRoute } from "./listContainerDocuments";
import { createListContainersRoute } from "./listContainers";
import { createMoveContainerRoute } from "./moveContainer";
import { createShareContainerRoute } from "./shareContainer";

interface ContainersRouterDeps {
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createContainersRouter({
  requireAuth,
  runtime,
}: ContainersRouterDeps = {}) {
  const containersRouter = new Hono();
  const routeDeps: ContainersRouterDeps = {};
  assignIfDefined(routeDeps, "requireAuth", requireAuth);
  assignIfDefined(routeDeps, "runtime", runtime);

  containersRouter.route("/", createCreateContainerRoute(routeDeps));
  containersRouter.route("/", createListContainerDocumentsRoute(routeDeps));
  containersRouter.route("/", createListContainersRoute(routeDeps));
  containersRouter.route("/", createMoveContainerRoute(routeDeps));
  containersRouter.route("/", createShareContainerRoute(routeDeps));

  return containersRouter;
}
