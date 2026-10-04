import type { RouteRequestBindings } from "./requestIp";

/** Keep active verification distinct from an idle connection waiting on a client. */
export function createAuthenticatedRequestBindings(
  request: Request,
  server: { timeout(request: Request, seconds: number): void },
): RouteRequestBindings {
  return {
    beginAuthenticatedWork: () => server.timeout(request, 0),
  };
}
