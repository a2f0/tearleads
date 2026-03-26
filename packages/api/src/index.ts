import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./routes/auth";
import { health } from "./routes/health";
import { itemsRouter } from "./routes/items";
import { websocket } from "./ws";

const app = new Hono();

app.use("*", cors());

app.route("/", auth);
app.route("/", health);
app.route("/", itemsRouter);

const server = {
  port: 3001,
  fetch(req: Request, server: { upgrade(req: Request): boolean }) {
    if (req.headers.get("upgrade") === "websocket") {
      if (server.upgrade(req)) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket,
};

export { app };
export default server;
