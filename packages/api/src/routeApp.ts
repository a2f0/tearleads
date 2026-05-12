import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  destroySession as defaultDestroySession,
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "./middleware/session";
import { createAuthRouter } from "./routes/auth";
import { createBlobsRouter } from "./routes/blobs";
import { createContainersRouter } from "./routes/containers";
import { createDocumentsRouter } from "./routes/documents";
import { createHealthRoute } from "./routes/health";
import { createOrganizationsRouter } from "./routes/organizations";
import { createPrincipalsRouter } from "./routes/principals";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "./services/runtime";

// Test seam
interface RouteAppOverrides {
  readonly destroySession?: (c: Context) => Promise<void>;
  readonly publish?: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

interface ResolvedRouteAppDeps {
  readonly destroySession: (c: Context) => Promise<void>;
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

const productionRouteAppOverrides: RouteAppOverrides = {
  destroySession: defaultDestroySession,
  requireAuth: defaultRequireAuth,
  runtime: defaultApiServiceRuntime,
};

function resolveRouteAppDeps({
  destroySession,
  publish,
  requireAuth,
  runtime,
}: RouteAppOverrides): ResolvedRouteAppDeps {
  const resolvedRuntime = runtime ?? defaultApiServiceRuntime;
  return {
    destroySession: destroySession ?? defaultDestroySession,
    publish: publish ?? resolvedRuntime.eventPublisher.publish,
    requireAuth: requireAuth ?? defaultRequireAuth,
    runtime: resolvedRuntime,
  };
}

export function createRouteApp(overrides: RouteAppOverrides) {
  const {
    destroySession: resolvedDestroySession,
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
