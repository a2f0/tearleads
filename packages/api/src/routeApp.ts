import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  destroySession as defaultDestroySession,
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "./middleware/session";
import { createAuthRouter } from "./routes/auth";
import { createContainersRouter } from "./routes/containers";
import { createDocumentsRouter } from "./routes/documents";
import { createStructuralDocumentsRoute } from "./routes/documents/structural";
import { createHealthRoute } from "./routes/health";
import { createPrincipalsRouter } from "./routes/principals";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "./services/runtime";

interface RouteAppDeps {
  readonly destroySession?: (c: Context) => Promise<void>;
  readonly publish?: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

const productionRouteAppDeps: RouteAppDeps = {
  destroySession: defaultDestroySession,
  requireAuth: defaultRequireAuth,
  runtime: defaultApiServiceRuntime,
};

export function createRouteApp({
  destroySession,
  publish,
  requireAuth,
  runtime,
}: RouteAppDeps) {
  const resolvedRuntime = runtime ?? defaultApiServiceRuntime;
  const resolvedDestroySession = destroySession ?? defaultDestroySession;
  const resolvedRequireAuth = requireAuth ?? defaultRequireAuth;
  const resolvedPublish = publish ?? resolvedRuntime.eventPublisher.publish;
  const routeApp = new Hono();

  routeApp.use("*", cors());

  routeApp.route(
    "/",
    createAuthRouter({
      destroySession: resolvedDestroySession,
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );
  routeApp.route(
    "/",
    createContainersRouter({
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
  routeApp.route(
    "/",
    createStructuralDocumentsRoute({
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );
  routeApp.route("/", createHealthRoute());
  routeApp.route(
    "/",
    createPrincipalsRouter({
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );

  return routeApp;
}

export const routeApp = createRouteApp(productionRouteAppDeps);
