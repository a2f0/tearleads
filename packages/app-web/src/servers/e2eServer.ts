import { serve } from "bun";
import sqliteRuntime from "../../e2e/fixtures/sqlite-runtime.html";
import { coreRoutes, devRoute } from "./serverConfig";

const { APP_WEB_PORT = "3100" } = process.env;
const appWebPort = Number(APP_WEB_PORT);

const server = serve({
  // Keep the development bundler but leave out Bun's hot-reload client: it
  // hard-reloads every connected page when its socket reconnects or the server
  // pushes an update, which discards a spec's unsaved state mid-run (#3161).
  development: { hmr: false },
  port: appWebPort,
  routes: { ...coreRoutes, "/e2e/sqlite-runtime": sqliteRuntime, ...devRoute },
  websocket: {
    message() {},
  },
});

console.log(`E2E server running at ${server.url}`);
