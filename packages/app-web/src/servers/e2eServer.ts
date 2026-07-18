import { serve } from "bun";
import { coreRoutes, devRoute } from "./serverConfig";

const { APP_WEB_PORT = "3100" } = process.env;
const appWebPort = Number(APP_WEB_PORT);

const server = serve({
  port: appWebPort,
  routes: { ...coreRoutes, ...devRoute },
  websocket: {
    message() {},
  },
});

console.log(`E2E server running at ${server.url}`);
