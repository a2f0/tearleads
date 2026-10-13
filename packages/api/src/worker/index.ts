import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
import { createBodyAdmission } from "./bodyAdmission";
import {
  bindWorkerEnvironment,
  realtimeHubStub,
  type WorkerBindings,
} from "./environment";
import {
  boundRequestBody,
  declaredBodyTooLarge,
  expectedRequestBytes,
  requestBodyCeiling,
  requestBodyOverflowed,
  retainUntilDrained,
} from "./requestBody";

export { KeyValueStore } from "./keyValueStoreObject";
export { RealtimeHub } from "./realtimeHubObject";

const EVENTS_PATH = "/events";

interface LoadedApp {
  /** The configured browser origins, for refusals the app never sees. */
  readonly corsOrigins: "*" | readonly string[];
  readonly fetch: (
    request: Request,
    bindings: Record<string, unknown>,
    ctx: ExecutionContext,
  ) => Response | Promise<Response>;
  readonly withRequestDatabase: <T>(
    run: () => Promise<T>,
    settle: (closing: Promise<void>) => void,
  ) => Promise<T>;
  /** Drain pending diagnostics; Workers cancel fetches after the response. */
  readonly flushDiagnostics: () => Promise<void>;
}

let app: Promise<LoadedApp> | undefined;
// One budget per isolate, which is the unit that shares a heap.
const bodyAdmission = createBodyAdmission();

// The Hono app, the database pool, the blob store, and Sentry all read
// configuration when their modules load, so the app is imported only after the
// first request has bound the Wrangler environment into `process.env`.
function loadApp(): Promise<LoadedApp> {
  app ??= Promise.all([
    import("../routeApp"),
    import("../corsOrigins"),
    import("../diagnostics/sentry"),
    import("@tearleads/api-shared/postgres"),
  ]).then(
    ([
      { routeApp },
      { readApiCorsOrigins },
      { flushApiDiagnostics },
      { withRequestScopedApiDatabase },
    ]) => ({
      corsOrigins: readApiCorsOrigins(),
      fetch: (request, bindings, ctx) => routeApp.fetch(request, bindings, ctx),
      flushDiagnostics: flushApiDiagnostics,
      withRequestDatabase: withRequestScopedApiDatabase,
    }),
  );
  return app;
}

/**
 * A refusal issued before the app runs still needs the app's CORS answer,
 * or a browser reports a network error instead of the status.
 */
function refuse(
  request: Request,
  corsOrigins: "*" | readonly string[],
  body: { readonly error: string },
  status: number,
): Response {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  if (corsOrigins === "*") {
    headers.set("access-control-allow-origin", "*");
  } else if (origin !== null && corsOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return Response.json(body, { status, headers });
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

async function handleRequest(
  request: Request,
  env: WorkerBindings,
  ctx: ExecutionContext,
): Promise<Response> {
  bindWorkerEnvironment(env);
  if (isWebSocketUpgrade(request)) {
    if (new URL(request.url).pathname !== EVENTS_PATH) {
      return new Response("WebSocket endpoint not found", { status: 404 });
    }
    return realtimeHubStub().fetch(request);
  }
  const { corsOrigins, fetch, flushDiagnostics, withRequestDatabase } =
    await loadApp();
  // Route-level limits still apply below this ceiling.
  const { pathname } = new URL(request.url);
  const ceiling = requestBodyCeiling(pathname, MAX_MULTIPART_BLOB_PART_BYTES);
  if (declaredBodyTooLarge(request, ceiling)) {
    return refuse(
      request,
      corsOrigins,
      { error: "Request body too large" },
      413,
    );
  }
  // Wait before wrapping or reading a body: queued requests must not buffer
  // uploads or open database pools while another response holds the budget.
  const admitted = expectedRequestBytes(request, pathname, ceiling);
  const release = await bodyAdmission.acquire(admitted, request.signal);
  if (!release) {
    const response = refuse(
      request,
      corsOrigins,
      { error: "Server busy, please retry" },
      503,
    );
    response.headers.set("retry-after", "1");
    return response;
  }
  try {
    const bounded = boundRequestBody(request, ceiling);
    if (bounded.kind === "too-large") {
      release();
      return refuse(
        request,
        corsOrigins,
        { error: "Request body too large" },
        413,
      );
    }
    // The request's database pool closes once the response is produced; the
    // close itself runs after the response so it never delays the client.
    const response = await withRequestDatabase(
      async () =>
        fetch(
          bounded.request,
          {
            ...env,
            // Cloudflare sets this from the connecting socket; proxies cannot
            // forge it.
            directClientIp: request.headers.get("cf-connecting-ip"),
            // Workers impose no idle timeout on a response, so there is nothing
            // to extend while a principal-history verification runs.
            beginPrincipalHistoryVerification: () => {},
          },
          ctx,
        ),
      (closing) => ctx.waitUntil(closing),
    ).catch((error: unknown) => {
      if (requestBodyOverflowed(bounded.request)) return null;
      throw error;
    });
    // Whatever the route made of a body cut off at the ceiling, and however
    // the runtime reported the failed read, the answer is 413.
    if (response === null || requestBodyOverflowed(bounded.request)) {
      release();
      return refuse(
        request,
        corsOrigins,
        { error: "Request body too large" },
        413,
      );
    }
    // A slow reader still holds the page until it drains or cancels the body.
    return retainUntilDrained(response, release);
  } catch (error) {
    release();
    throw error;
  } finally {
    // Sentry sends after the response would be canceled with the request.
    ctx.waitUntil(flushDiagnostics());
  }
}

async function handleScheduled(
  controller: ScheduledController,
  env: WorkerBindings,
  ctx: ExecutionContext,
): Promise<void> {
  bindWorkerEnvironment(env);
  const [{ runScheduledMaintenance }, { withRequestDatabase }] =
    await Promise.all([import("./maintenance"), loadApp()]);
  await withRequestDatabase(
    () => runScheduledMaintenance(controller.cron),
    (closing) => ctx.waitUntil(closing),
  );
}

export default {
  fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext) {
    return handleRequest(request, env, ctx);
  },
  scheduled(
    controller: ScheduledController,
    env: WorkerBindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(handleScheduled(controller, env, ctx));
  },
};
