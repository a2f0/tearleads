import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./routes/auth";
import { containersRouter } from "./routes/containers";
import { documentsRouter } from "./routes/documents";
import { health } from "./routes/health";

const routeApp = new Hono();

routeApp.use("*", cors());

routeApp.route("/", auth);
routeApp.route("/", containersRouter);
routeApp.route("/", documentsRouter);
routeApp.route("/", health);

export { routeApp };
