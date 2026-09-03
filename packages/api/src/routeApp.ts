import {
  operationRequestHeaderNames,
  operationResponseHeaderNames,
  protocolOperations,
} from "@tearleads/validators/operation";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type ApiCorsOrigins, readApiCorsOrigins } from "./corsOrigins";
import type { SessionEnv } from "./middleware/session";
import type { PublishedRealtimeEvent } from "./realtime/publishedRealtimeEvents";
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
import { createPrincipalPolicyRoute } from "./routes/principals/policy";
import {
  publishOrganizationReadModelChanged,
  resolveCommittedOrganizationReadModelChanges,
} from "./services/organizations/readModelNotifications";
import type { ApiServiceRuntime } from "./services/runtime";
import { isTransientDatabaseFailure } from "./utils/databaseErrors";
import { OrganizationSyncDisabledError } from "./workflows/billing/organizationSyncEligibility";
import { collectOrganizationReadModelChanges } from "./workflows/organizations/readModelChanges";

interface RouteAppOptions {
  readonly corsOrigins?: ApiCorsOrigins | undefined;
}

const API_CORS_ALLOW_HEADERS = [
  "Authorization",
  "Content-Type",
  ...new Set(protocolOperations.flatMap(operationRequestHeaderNames)),
];
const API_CORS_EXPOSE_HEADERS = [
  ...new Set(
    protocolOperations.flatMap((operation) =>
      operationResponseHeaderNames(operation),
    ),
  ),
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

function createApiCorsMiddleware(origins: ApiCorsOrigins) {
  return cors({
    allowHeaders: API_CORS_ALLOW_HEADERS,
    allowMethods: API_CORS_ALLOW_METHODS,
    exposeHeaders: API_CORS_EXPOSE_HEADERS,
    maxAge: API_CORS_MAX_AGE_SECONDS,
    origin: origins === "*" ? "*" : [...origins],
  });
}

function createReadModelHintMiddleware(
  publish: (event: PublishedRealtimeEvent) => Promise<void>,
  runtime: ApiServiceRuntime,
): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const { observedChanges } = await collectOrganizationReadModelChanges(
      async () => {
        await next();
      },
    );
    if (observedChanges.length === 0) {
      return;
    }
    const session = c.get("session");
    if (!session) {
      // Unauthenticated provisioning has no connected authoring session yet.
      return;
    }
    let committedChanges: Awaited<
      ReturnType<typeof resolveCommittedOrganizationReadModelChanges>
    >;
    try {
      committedChanges = await resolveCommittedOrganizationReadModelChanges({
        observedChanges,
        runtime,
      });
    } catch (error) {
      // Realtime is a lossy wake-up. The feed remains authoritative, so a
      // verification failure must not change the HTTP response.
      console.error(
        "Failed to verify organization read-model notifications:",
        error,
      );
      return;
    }
    await Promise.all(
      committedChanges.map(({ organizationId, recipientUserIds }) =>
        publishOrganizationReadModelChanged({
          organizationId,
          origin: { sessionId: session.id, userId: session.userId },
          publish,
          recipientUserIds,
        }),
      ),
    );
  };
}

function organizationSyncErrorBody(error: OrganizationSyncDisabledError) {
  return {
    error: error.message,
    organizationId: error.organizationId,
    reason: error.reason,
  };
}

/**
 * Hono's `.request()` test helper bypasses the HTTP transport that supplies a
 * Content-Length for string bodies. Mirror that transport behavior for
 * in-process route tests while leaving prebuilt Request objects untouched so
 * missing-length boundary cases can still be exercised explicitly.
 */
function installInProcessStringBodyLength(app: Hono<SessionEnv>): void {
  const request = app.request.bind(app);
  app.request = (input, requestInit, env, executionContext) => {
    if (input instanceof Request || typeof requestInit?.body !== "string") {
      return request(input, requestInit, env, executionContext);
    }
    const headers = new Headers(requestInit.headers);
    if (!headers.has("Content-Length")) {
      headers.set(
        "Content-Length",
        new TextEncoder().encode(requestInit.body).byteLength.toString(),
      );
    }
    return request(input, { ...requestInit, headers }, env, executionContext);
  };
}

function createApiRouteApp(): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();
  installInProcessStringBodyLength(app);
  return app;
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
  const routeApp = createApiRouteApp();

  const corsOrigins = options.corsOrigins ?? readApiCorsOrigins();
  routeApp.use("*", createApiCorsMiddleware(corsOrigins));
  routeApp.use(
    "*",
    createReadModelHintMiddleware(resolvedPublish, resolvedRuntime),
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
      corsOrigins,
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
    createPrincipalPolicyRoute({
      publish: resolvedPublish,
      requireAuth: resolvedRequireAuth,
      runtime: resolvedRuntime,
    }),
  );

  // Sync writes blocked by organization entitlement or the caller's stable seat
  // throw deep in their workflows; surface both uniformly as 402 responses.
  routeApp.onError((error, c) => {
    if (error instanceof OrganizationSyncDisabledError) {
      return c.json(organizationSyncErrorBody(error), 402);
    }
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    if (isTransientDatabaseFailure(error)) {
      console.error(error);
      return c.json({ error: "Database temporarily unavailable" }, 503);
    }
    console.error(error);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return routeApp;
}

export const routeApp = createRouteApp(productionRouteAppOverrides);
