import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";

let origin: Promise<string> | undefined;

/**
 * One real API per test process, over real HTTP: every device talks to it
 * through the SDK's own `ApiClient`, exactly as a deployed client would.
 */
export function startApiServer(): Promise<string> {
  origin ??= (async () => {
    await initializeApiDatabase();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => routeApp.fetch(request),
    });
    return server.url.origin;
  })();
  return origin;
}
