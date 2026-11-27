import {
  createIsLiveUserSession,
  createRealtimeGateway,
  createRouteApp,
  createWebSocketTicketConsumer,
  getDefaultApiServiceRuntime,
  initializeApiDatabase,
} from "@tearleads/api/test-runtime";
import { trace } from "./trace";

let origin: Promise<string> | undefined;

const httpSinkKey = "__tearleadsPerfScenarioHttpSink";

interface ScenarioHttpObservation {
  readonly authorization: string | null;
  readonly durationMs: number;
  readonly knownManifestsCount: number;
  readonly method: string;
  readonly requestBody: string | null;
  readonly requestBodyBytes: number;
  readonly responseBody: string;
  readonly responseBodyBytes: number;
  readonly status: number;
  readonly url: string;
}

interface WsSocketData {
  readonly sessionId: string;
  readonly userId: string;
}

function activeHttpSink():
  | ((observation: ScenarioHttpObservation) => void)
  | null {
  const sink: unknown = Reflect.get(globalThis, httpSinkKey);
  if (typeof sink !== "function") return null;
  return (observation) => {
    sink(observation);
  };
}

function countKnownManifests(header: string | null): number {
  if (!header) return 0;
  return header
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0).length;
}

function isUncompressedJson(headers: Headers): boolean {
  return (
    !headers.has("content-encoding") &&
    (headers.get("content-type") ?? "").includes("application/json")
  );
}

/** Traces each refused request with the API's error body. */
async function serve(
  routeApp: ReturnType<typeof createRouteApp>,
  request: Request,
): Promise<Response> {
  const sink = activeHttpSink();
  let requestBytes = 0;
  let requestBody: string | null = null;
  if (sink && request.method !== "GET" && request.method !== "HEAD") {
    const raw = await request.clone().arrayBuffer();
    requestBytes = raw.byteLength;
    if (requestBytes > 0 && isUncompressedJson(request.headers)) {
      requestBody = new TextDecoder().decode(raw);
    }
  }
  const startedAt = sink ? performance.now() : 0;
  const response = await routeApp.fetch(request);
  const durationMs = sink ? performance.now() - startedAt : 0;
  if (sink) {
    const rawResponse = await response.clone().arrayBuffer();
    const responseBody =
      rawResponse.byteLength > 0 && isUncompressedJson(response.headers)
        ? new TextDecoder().decode(rawResponse)
        : "";
    sink({
      authorization: request.headers.get("authorization"),
      durationMs,
      knownManifestsCount: countKnownManifests(
        request.headers.get("x-known-manifests"),
      ),
      method: request.method,
      requestBody,
      requestBodyBytes: requestBytes,
      responseBody,
      responseBodyBytes: rawResponse.byteLength,
      status: response.status,
      url: request.url,
    });
  }
  if (response.status >= 400) {
    const body = await response.clone().text();
    const { pathname } = new URL(request.url);
    trace(`${request.method} ${pathname} ${response.status} ${body}`);
  }
  return response;
}

async function upgradeEventsWebSocket(
  request: Request,
  bunServer: Bun.Server<WsSocketData>,
  consumeTicket: ReturnType<typeof createWebSocketTicketConsumer>,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/events") {
    return new Response("WebSocket endpoint not found", { status: 404 });
  }
  const identity = await consumeTicket(url.searchParams.get("ticket") ?? "");
  if (!identity) {
    return new Response("WebSocket ticket required", { status: 401 });
  }
  if (bunServer.upgrade(request, { data: identity })) {
    return undefined;
  }
  return new Response("WebSocket upgrade failed", { status: 400 });
}

/**
 * One real API per test process, over real HTTP and WebSocket: every device
 * talks to it through the SDK's own `ApiClient` and realtime socket, exactly
 * as a deployed client would.
 */
export function startApiServer(): Promise<string> {
  origin ??= (async () => {
    await initializeApiDatabase();
    const defaultRuntime = getDefaultApiServiceRuntime();
    const isLiveSession = createIsLiveUserSession(
      defaultRuntime.keyValueStore.get,
    );
    const consumeTicket = createWebSocketTicketConsumer(isLiveSession);
    const realtimeGateway = createRealtimeGateway({
      validateSession: isLiveSession,
    });
    realtimeGateway.start();
    const server = Bun.serve<WsSocketData>({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, bunServer) =>
        request.headers.get("upgrade")?.toLowerCase() === "websocket"
          ? upgradeEventsWebSocket(request, bunServer, consumeTicket)
          : serve(routeApp, request),
      websocket: realtimeGateway.websocket,
    });
    // Proxies retain their per-device login origins, but identities share one
    // stable API domain, just as a deployment with an explicit domain does.
    const routeApp = createRouteApp({
      runtime: {
        ...defaultRuntime,
        identityTrustDomain: server.url.origin,
      },
    });
    return server.url.origin;
  })();
  return origin;
}
