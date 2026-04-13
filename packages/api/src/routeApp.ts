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
import { assignIfDefined } from "./utils/object";

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
  const authRouterDeps: Parameters<typeof createAuthRouter>[0] = {};
  assignIfDefined(authRouterDeps, "destroySession", destroySession);
  assignIfDefined(authRouterDeps, "requireAuth", requireAuth);
  assignIfDefined(authRouterDeps, "runtime", runtime);

  const protectedRouterDeps: Parameters<typeof createContainersRouter>[0] = {};
  assignIfDefined(protectedRouterDeps, "requireAuth", requireAuth);
  assignIfDefined(protectedRouterDeps, "runtime", runtime);

  const documentsRouterDeps: Parameters<typeof createDocumentsRouter>[0] = {};
  assignIfDefined(documentsRouterDeps, "publish", publish);
  assignIfDefined(documentsRouterDeps, "requireAuth", requireAuth);
  assignIfDefined(documentsRouterDeps, "runtime", runtime);

  routeApp.use("*", cors());

  routeApp.route("/", createAuthRouter(authRouterDeps));
  routeApp.route("/", createContainersRouter(protectedRouterDeps));
  routeApp.route("/", createDocumentsRouter(documentsRouterDeps));
  routeApp.route("/", createStructuralDocumentsRoute(protectedRouterDeps));
  routeApp.route("/", createHealthRoute());
  routeApp.route("/", createPrincipalsRouter(protectedRouterDeps));

  return routeApp;
}

export const routeApp = createRouteApp();
