import {
  getDefaultApiDatabaseKind,
  initializeApiDatabase,
} from "@tearleads/api-shared/postgres";
import type { RouteRequestBindings } from "./requestContext";
import { routeApp } from "./routeApp";
import { websocket } from "./ws";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import { consumeWebSocketTicket } from "./wsTicket";

if (getDefaultApiDatabaseKind() === "memory") {
  await initializeApiDatabase();
}

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

const server = {
  port: 3001,
  fetch(
    req: Request,
    server: ApiServer,
  ): Response | Promise<Response | undefined> {
    if (req.headers.get("upgrade") === "websocket") {
      return resolveWebSocketUpgrade(req, server);
    }
    return routeApp.fetch(req, createRouteRequestBindings(req, server));
  },
  websocket,
};
export default server;
