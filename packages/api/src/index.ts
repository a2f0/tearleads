import {
  getDefaultApiDatabaseKind,
  initializeApiDatabase,
} from "@symcrypt/api-shared/postgres";
import { MAX_UPLOAD_PART_BYTES } from "./adapters/blobObjectStore";
import type { RouteRequestBindings } from "./middleware/session";
import { createRealtimeGateway } from "./realtime/realtimeGateway";
import type { WebSocketTicketIdentity } from "./realtime/wsIdentity";
import { consumeWebSocketTicket } from "./realtime/wsTicket";
import { routeApp } from "./routeApp";

const defaultDatabaseKind = getDefaultApiDatabaseKind();
if (
  defaultDatabaseKind === "memory" ||
  (defaultDatabaseKind === "sqlite" && process.env.NODE_ENV !== "production")
) {
  await initializeApiDatabase();
}

// The realtime gateway is the second half of this composition root: build it
// once here, alongside the HTTP app, and open its Redis subscription explicitly.
// Constructing it is side-effect free; start() is what subscribes.
const realtimeGateway = createRealtimeGateway();
realtimeGateway.start();

interface ApiServer {
  requestIP(req: Request): { address: string } | null;
  upgrade(req: Request, options?: { data?: WebSocketTicketIdentity }): boolean;
}

/**
 * Authenticate and perform a websocket upgrade. The handshake must carry a
 * single-use `ticket` query param minted by `POST /auth/ws-ticket`; it is
 * consumed atomically here. A missing/expired/already-used ticket is rejected
 * before the upgrade, and the resolved identity is bound to the socket via
 * `ws.data` for later scoped routing. Exported (with an injectable consumer) so
 * the auth gate is unit-testable without a live Bun socket.
 */
export async function resolveWebSocketUpgrade(
  req: Request,
  server: Pick<ApiServer, "upgrade">,
  consume: (
    ticket: string,
  ) => Promise<WebSocketTicketIdentity | null> = consumeWebSocketTicket,
): Promise<Response | undefined> {
  // Fall back to a base so a relative req.url (mock/test envs) parses instead
  // of throwing; the base is ignored for the absolute URLs Bun provides.
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/events") {
    return new Response("WebSocket endpoint not found", { status: 404 });
  }

  const ticket = url.searchParams.get("ticket") ?? "";
  const identity = await consume(ticket);
  if (!identity) {
    return new Response("WebSocket ticket required", { status: 401 });
  }

  if (server.upgrade(req, { data: identity })) {
    return undefined;
  }
  return new Response("WebSocket upgrade failed", { status: 400 });
}

export function createRouteRequestBindings(
  req: Request,
  server: Pick<ApiServer, "requestIP">,
): RouteRequestBindings {
  try {
    const address = server.requestIP(req)?.address;
    return address ? { directClientIp: address } : {};
  } catch {
    return {};
  }
}

const { API_HOST = "0.0.0.0", API_PORT = "3001" } = process.env;

const server = {
  hostname: API_HOST,
  port: Number(API_PORT),
  // Bound every request body to the multipart part ceiling. The part route reads
  // its body with c.req.arrayBuffer() (Bun's native read, which sidesteps the
  // native-stream defect that segfaulted the streamed reader), so this server cap
  // is what keeps that buffered read from growing unbounded — Bun rejects a larger
  // body with a 413 before the handler allocates it. Blob parts are the only
  // bodies that approach this size; everything else is small JSON.
  maxRequestBodySize: MAX_UPLOAD_PART_BYTES,
  fetch(
    req: Request,
    server: ApiServer,
  ): Response | Promise<Response | undefined> {
    if (req.headers.get("upgrade") === "websocket") {
      return resolveWebSocketUpgrade(req, server);
    }
    return routeApp.fetch(req, createRouteRequestBindings(req, server));
  },
  websocket: realtimeGateway.websocket,
};
export default server;
