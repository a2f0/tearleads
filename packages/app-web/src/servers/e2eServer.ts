import { serve } from "bun";
import sqliteRuntime from "../../e2e/fixtures/sqlite-runtime.html";
import { coreRoutes, devRoute } from "./serverConfig";

const { APP_WEB_PORT = "3100" } = process.env;
const appWebPort = Number(APP_WEB_PORT);

const server = serve({
  port: appWebPort,
  routes: { ...coreRoutes, "/e2e/sqlite-runtime": sqliteRuntime, ...devRoute },
  websocket: {
    message() {},
  },
});

console.log(`E2E server running at ${server.url}`);
