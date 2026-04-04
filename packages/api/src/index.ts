import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./routes/auth";
import { containersRouter } from "./routes/containers";
import { documentsRouter } from "./routes/documents";
import { health } from "./routes/health";
import { websocket } from "./ws";

const app = new Hono();

app.use("*", cors());

app.route("/", auth);
app.route("/", containersRouter);
app.route("/", documentsRouter);
app.route("/", health);

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
