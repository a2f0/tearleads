import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./routes/auth";
import { health } from "./routes/health";

export const app = new Hono();

app.use("*", cors());

app.route("/", auth);
app.route("/", health);

export default {
  port: 3001,
  fetch: app.fetch,
};
