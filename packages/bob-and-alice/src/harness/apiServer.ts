import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { trace } from "./trace";

let origin: Promise<string> | undefined;

/** Traces each refused request with the API's error body. */
async function serve(request: Request): Promise<Response> {
  const response = await routeApp.fetch(request);
  if (response.status >= 400) {
    const body = await response.clone().text();
    const { pathname } = new URL(request.url);
    trace(`${request.method} ${pathname} ${response.status} ${body}`);
  }
  return response;
}

/**
 * One real API per test process, over real HTTP: every device talks to it
 * through the SDK's own `ApiClient`, exactly as a deployed client would.
 */
export function startApiServer(): Promise<string> {
  origin ??= (async () => {
    await initializeApiDatabase();
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: serve });
    return server.url.origin;
  })();
  return origin;
}
