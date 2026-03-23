import { Hono } from "hono";
import { health } from "./routes/health";
import { publicKey } from "./routes/publicKey";

export const app = new Hono();

app.route("/", health);
app.route("/", publicKey);

export default {
  port: 3001,
  fetch: app.fetch,
};
