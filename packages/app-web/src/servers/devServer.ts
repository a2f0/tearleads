import { serve } from "bun";
import { coreRoutes, devRoute } from "./serverConfig";

const server = serve({
  routes: { ...coreRoutes, ...devRoute },
  development: { hmr: true, console: true },
  websocket: {
    message() {},
  },
});

console.log(`Server running at ${server.url}`);
