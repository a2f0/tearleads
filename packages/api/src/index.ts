import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./routes/auth";
import { health } from "./routes/health";
import { itemsRouter } from "./routes/items";

export const app = new Hono();

app.use("*", cors());

app.route("/", auth);
app.route("/", health);
app.route("/", itemsRouter);

export default {
  port: 3001,
  fetch: app.fetch,
};
