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

interface WsSocketData {
  readonly sessionId: string;
  readonly userId: string;
}

/** Traces each refused request with the API's error body. */
async function serve(
  routeApp: ReturnType<typeof createRouteApp>,
  request: Request,
): Promise<Response> {
  const response = await routeApp.fetch(request);
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
