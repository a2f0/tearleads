import { routeApp } from "./routeApp";
import { websocket } from "./ws";

const server = {
  port: 3001,
  fetch(req: Request, server: { upgrade(req: Request): boolean }) {
    if (req.headers.get("upgrade") === "websocket") {
      if (server.upgrade(req)) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return routeApp.fetch(req);
  },
  websocket,
};
export default server;
