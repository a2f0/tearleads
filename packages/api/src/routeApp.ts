import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  productionRouteAppOverrides,
  type RouteAppOverrides,
  resolveRouteAppDeps,
} from "./routeAppDeps";
import { createAuthRouter } from "./routes/auth";
import { createBlobsRouter } from "./routes/blobs";
import { createContainersRouter } from "./routes/containers";
import { createDocumentsRouter } from "./routes/documents";
import { createHealthRoute } from "./routes/health";
import { createOrganizationsRouter } from "./routes/organizations";
import { createPrincipalsRouter } from "./routes/principals";

export function createRouteApp(overrides: RouteAppOverrides) {
  const {
    destroySession: resolvedDestroySession,
    destroyUserSession: resolvedDestroyUserSession,
    listUserSessions: resolvedListUserSessions,
    publish: resolvedPublish,
    requireAuth: resolvedRequireAuth,
    runtime: resolvedRuntime,
  } = resolveRouteAppDeps(overrides);
  const routeApp = new Hono();

  routeApp.use("*", cors());

  routeApp.route(
    "/",
    createAuthRouter({
      destroySession: resolvedDestroySession,
      destroyUserSession: resolvedDestroyUserSession,
      listUserSessions: resolvedListUserSessions,
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );
  routeApp.route(
    "/",
    createContainersRouter({
      publish: resolvedPublish,
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );
  routeApp.route(
    "/",
    createBlobsRouter({
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );
  routeApp.route(
    "/",
    createDocumentsRouter({
      publish: resolvedPublish,
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );
  routeApp.route("/", createHealthRoute());
  routeApp.route(
    "/",
    createOrganizationsRouter({
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );
  routeApp.route(
    "/",
    createPrincipalsRouter({
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );

  return routeApp;
}

export const routeApp = createRouteApp(productionRouteAppOverrides);
