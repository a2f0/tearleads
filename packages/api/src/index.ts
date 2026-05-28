import type { RouteRequestBindings } from "./requestContext";
import { routeApp } from "./routeApp";
import { websocket } from "./ws";

interface ApiServer {
  requestIP(req: Request): { address: string } | null;
  upgrade(req: Request): boolean;
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
  fetch(req: Request, server: ApiServer) {
    if (req.headers.get("upgrade") === "websocket") {
      if (server.upgrade(req)) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return routeApp.fetch(req, createRouteRequestBindings(req, server));
  },
  websocket,
};
export default server;
