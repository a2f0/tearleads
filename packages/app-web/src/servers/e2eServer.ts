import { serve } from "bun";
import { coreRoutes, devRoute } from "./serverConfig";

const server = serve({
  port: 3100,
  routes: { ...coreRoutes, ...devRoute },
  websocket: {
    message() {},
  },
});

console.log(`E2E server running at ${server.url}`);
