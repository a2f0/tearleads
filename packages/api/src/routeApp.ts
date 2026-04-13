import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SessionEnv } from "./middleware/session";
import { createAuthRouter } from "./routes/auth";
import { createContainersRouter } from "./routes/containers";
import { createDocumentsRouter } from "./routes/documents";
import { createStructuralDocumentsRoute } from "./routes/documents/structural";
import { createHealthRoute } from "./routes/health";
import { createPrincipalsRouter } from "./routes/principals";
import type { ApiServiceRuntime } from "./services/runtime";

interface RouteAppDeps {
  readonly destroySession?: (c: Context) => Promise<void>;
  readonly publish?: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createRouteApp({
  destroySession,
  publish,
  requireAuth,
  runtime,
}: RouteAppDeps = {}) {
  const routeApp = new Hono();
  const authRouterDeps = {
    ...(destroySession ? { destroySession } : {}),
    ...(requireAuth ? { requireAuth } : {}),
    ...(runtime ? { runtime } : {}),
  };
  const containersRouterDeps = {
    ...(requireAuth ? { requireAuth } : {}),
    ...(runtime ? { runtime } : {}),
  };
  const documentsRouterDeps = {
    ...(publish ? { publish } : {}),
    ...(requireAuth ? { requireAuth } : {}),
    ...(runtime ? { runtime } : {}),
  };
  const principalsRouterDeps = {
    ...(requireAuth ? { requireAuth } : {}),
    ...(runtime ? { runtime } : {}),
  };

  routeApp.use("*", cors());

  routeApp.route("/", createAuthRouter(authRouterDeps));
  routeApp.route("/", createContainersRouter(containersRouterDeps));
  routeApp.route("/", createDocumentsRouter(documentsRouterDeps));
  routeApp.route(
    "/",
    createStructuralDocumentsRoute({
      ...(requireAuth ? { requireAuth } : {}),
      ...(runtime ? { runtime } : {}),
    }),
  );
  routeApp.route("/", createHealthRoute());
  routeApp.route("/", createPrincipalsRouter(principalsRouterDeps));

  return routeApp;
}

export const routeApp = createRouteApp();
