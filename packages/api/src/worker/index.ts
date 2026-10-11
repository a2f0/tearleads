import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
import {
  bindWorkerEnvironment,
  realtimeHubStub,
  type WorkerBindings,
} from "./environment";
import { boundRequestBody } from "./requestBody";

export { KeyValueStore } from "./keyValueStoreObject";
export { RealtimeHub } from "./realtimeHubObject";

const EVENTS_PATH = "/events";

interface LoadedApp {
  readonly fetch: (
    request: Request,
    bindings: Record<string, unknown>,
    ctx: ExecutionContext,
  ) => Response | Promise<Response>;
  readonly withRequestDatabase: <T>(
    run: () => Promise<T>,
    settle: (closing: Promise<void>) => void,
  ) => Promise<T>;
}

let app: Promise<LoadedApp> | undefined;

// The Hono app, the database pool, the blob store, and Sentry all read
// configuration when their modules load, so the app is imported only after the
// first request has bound the Wrangler environment into `process.env`.
function loadApp(): Promise<LoadedApp> {
  app ??= Promise.all([
    import("../routeApp"),
    import("@tearleads/api-shared/postgres"),
  ]).then(([{ routeApp }, { withRequestScopedApiDatabase }]) => ({
    fetch: (request, bindings, ctx) => routeApp.fetch(request, bindings, ctx),
    withRequestDatabase: withRequestScopedApiDatabase,
  }));
  return app;
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
  // Route-level limits still apply below this ceiling.
  const bounded = await boundRequestBody(
    request,
    MAX_MULTIPART_BLOB_PART_BYTES,
  );
  if (bounded.kind === "too-large") {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }
  const { fetch, withRequestDatabase } = await loadApp();
  // The request's database pool closes once the response is produced; the
  // close itself runs after the response so it never delays the client.
  return withRequestDatabase(
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
  );
}

async function handleScheduled(
  controller: ScheduledController,
  env: WorkerBindings,
): Promise<void> {
  bindWorkerEnvironment(env);
  const [{ runScheduledMaintenance }, { withRequestDatabase }] =
    await Promise.all([import("./maintenance"), loadApp()]);
  await withRequestDatabase(
    () => runScheduledMaintenance(controller.cron),
    (closing) => closing,
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
    ctx.waitUntil(handleScheduled(controller, env));
  },
};
