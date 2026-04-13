import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import {
  createContainerRoute,
  createCreateContainerRoute,
} from "./createContainer";
import {
  createListContainerDocumentsRoute,
  listContainerDocumentsRoute,
} from "./listContainerDocuments";
import {
  createListContainersRoute,
  listContainersRoute,
} from "./listContainers";
import { createMoveContainerRoute, moveContainerRoute } from "./moveContainer";
import {
  createShareContainerRoute,
  shareContainerRoute,
} from "./shareContainer";

export const containersRouter = new Hono();

containersRouter.route("/", createContainerRoute);
containersRouter.route("/", listContainerDocumentsRoute);
containersRouter.route("/", listContainersRoute);
containersRouter.route("/", moveContainerRoute);
containersRouter.route("/", shareContainerRoute);

interface ContainersRouterDeps {
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createContainersRouter({
  requireAuth,
  runtime,
}: ContainersRouterDeps = {}) {
  const containersRouter = new Hono();
  const routeDeps = {
    ...(requireAuth ? { requireAuth } : {}),
    ...(runtime ? { runtime } : {}),
  };

  containersRouter.route("/", createCreateContainerRoute(routeDeps));
  containersRouter.route("/", createListContainerDocumentsRoute(routeDeps));
  containersRouter.route("/", createListContainersRoute(routeDeps));
  containersRouter.route("/", createMoveContainerRoute(routeDeps));
  containersRouter.route("/", createShareContainerRoute(routeDeps));

  return containersRouter;
}
