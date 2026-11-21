import { ApiClient } from "@tearleads/api-client";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";

/**
 * A real API client over a local server. The first request matching `path`
 * waits until the test releases it, then answers a refresh-required 401;
 * later matches get `respond`. Renewal installs a new token for the same
 * identity, so an unguarded request is replayed.
 */
export function createExpiringApiServer(input: {
  readonly method: string;
  readonly path: RegExp;
  readonly respond?: ((request: Request) => Promise<Response>) | undefined;
}) {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method !== input.method || !input.path.test(pathname))
        return Response.json({ error: "Not found" }, { status: 404 });
      requests.push(`${request.method} ${pathname}`);
      if (requests.length > 1)
        return input.respond
          ? input.respond(request)
          : Response.json({ error: "Unexpected replay" }, { status: 500 });
      entered.resolve();
      await release.promise;
      return Response.json(
        { code: SESSION_ERROR_CODES.refreshRequired, error: "Expired session" },
        { status: 401 },
      );
    },
  });
  const api = new ApiClient(server.url.origin);
  api.setAuthToken("identity-a");
  const renewals = { count: 0 };
  api.setOnSessionExpired(() => {
    renewals.count += 1;
    api.setAuthToken("identity-a-renewed");
    return true;
  });
  return {
    api,
    entered: entered.promise,
    release: () => release.resolve(),
    renewals,
    requests,
    /** Switching organization retires the caller; a sign-in also ends its session. */
    retire(change: "organization change" | "independent sign-in") {
      if (change === "independent sign-in")
        api.setAuthToken("identity-b", { boundary: "replacement" });
    },
    stop: () => server.stop(true),
  };
}

export const SCOPE_RETIREMENTS = [
  "organization change",
  "independent sign-in",
] as const;
