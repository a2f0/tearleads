import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  productionRouteAppOverrides,
  type RouteAppOverrides,
  resolveRouteAppDeps,
} from "./routeAppDeps";
import { createAuthRouter } from "./routes/auth";
import { createBillingRouter } from "./routes/billing";
import { createBlobsRouter } from "./routes/blobs";
import { createContainersRouter } from "./routes/containers";
import { createDocumentsRouter } from "./routes/documents";
import { createHealthRoute } from "./routes/health";
import { createOrganizationsRouter } from "./routes/organizations";
import { createPrincipalsRouter } from "./routes/principals";
import { OrganizationSyncDisabledError } from "./workflows/billing/organizationBilling";

type ApiCorsOrigins = "*" | readonly string[];

interface RouteAppOptions {
  readonly corsOrigins?: ApiCorsOrigins | undefined;
}

interface ApiCorsEnv {
  readonly API_CORS_ORIGINS?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

const API_CORS_ALLOW_HEADERS = [
  "Authorization",
  "Content-Type",
  "X-Tearleads-Blob-Part-Byte-Length",
  "X-Tearleads-Blob-Part-Sha256",
  "X-Tearleads-Blob-Upload-Id",
];
const API_CORS_ALLOW_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
];
const API_CORS_MAX_AGE_SECONDS = 86400;

function parseConfiguredApiCorsOrigins(value: string): ApiCorsOrigins {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error("API_CORS_ORIGINS must include at least one origin");
  }
  if (origins.includes("*")) {
    if (origins.length > 1) {
      throw new Error("API_CORS_ORIGINS cannot mix * with explicit origins");
    }
    return "*";
  }

  return origins;
}

export function readApiCorsOrigins(
  env: ApiCorsEnv = process.env,
): ApiCorsOrigins {
  const configured = env.API_CORS_ORIGINS?.trim();
  if (configured) {
    return parseConfiguredApiCorsOrigins(configured);
  }
  if (env.NODE_ENV?.trim() === "production") {
    throw new Error("API_CORS_ORIGINS is required when NODE_ENV=production");
  }

  return "*";
}

function createApiCorsMiddleware(origins: ApiCorsOrigins) {
  return cors({
    allowHeaders: API_CORS_ALLOW_HEADERS,
    allowMethods: API_CORS_ALLOW_METHODS,
    maxAge: API_CORS_MAX_AGE_SECONDS,
    origin: origins === "*" ? "*" : [...origins],
  });
}

export function createRouteApp(
  overrides: RouteAppOverrides,
  options: RouteAppOptions = {},
) {
  const {
    destroySession: resolvedDestroySession,
    destroyUserSession: resolvedDestroyUserSession,
    listUserSessions: resolvedListUserSessions,
    publish: resolvedPublish,
    requireAuth: resolvedRequireAuth,
    runtime: resolvedRuntime,
  } = resolveRouteAppDeps(overrides);
  const routeApp = new Hono();

  routeApp.use(
    "*",
    createApiCorsMiddleware(options.corsOrigins ?? readApiCorsOrigins()),
  );

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
    createBillingRouter({
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );
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
      publish: resolvedPublish,
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );

  // Sync writes that target an organization which cannot sync throw
  // OrganizationSyncDisabledError deep in their workflows; surface it uniformly
  // as 402 rather than letting it fall through to a 500.
  routeApp.onError((error, c) => {
    if (error instanceof OrganizationSyncDisabledError) {
      return c.json(
        { error: error.message, organizationId: error.organizationId },
        402,
      );
    }
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    console.error(error);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return routeApp;
}

export const routeApp = createRouteApp(productionRouteAppOverrides);
