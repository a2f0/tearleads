import { afterAll } from "bun:test";
import { http } from "msw";
import { setupServer } from "msw/node";
import { rootConsoleHandlers } from "../rootConsoleHandlers";
import { recordUnhandledRequest } from "../unhandledRequests";
import { authHandlers, resetMockAuth } from "./authHandlers";
import {
  drainSocketClients,
  eventRouter,
  eventsSocketHandler,
} from "./eventsSocket";
import { organizationHandlers } from "./organizationHandlers";
import {
  clearProxiedApiRequests,
  PROXIED_API_SETTLE_TIMEOUT_MS,
  proxyRequestToApiApp,
  type TestApiAppHandlerOptions,
  waitForProxiedApiRequestsToSettle,
} from "./proxiedApi";
import { syncHandlers } from "./syncHandlers";
import { forgetTestApiApp, resetTestApiDatabase } from "./testApiApp";

// The suite's MSW entry point: importing it starts the server, so tests and
// helpers read the proxied-request log and the socket URL through it.
export { wsUrl } from "./eventsSocket";
export {
  getProxiedApiNetworkActivitySnapshot,
  listProxiedApiRequests,
} from "./proxiedApi";

interface ResetMockServerOptions {
  proxiedApiQuietMs?: number;
  proxiedApiTimeoutMs?: number;
}

const server = setupServer(
  eventsSocketHandler,
  ...authHandlers,
  ...organizationHandlers,
  ...rootConsoleHandlers,
  ...syncHandlers,
);

server.listen({
  onUnhandledRequest: (request, print) => {
    recordUnhandledRequest(
      `${request.method} ${new URL(request.url).pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/giu, "/:id")}`,
    );
    // print.error() is the "error" strategy's body: log, then throw so the
    // request rejects. happydom.ts asserts on what was recorded at the end of
    // the run. Note a callback is stricter than the "error" string, which
    // exempts asset-shaped URLs (.json, .css, fonts) and lets them escape to the
    // real network — an exemption for browser dev-server noise that this
    // bun/happy-dom suite has no use for.
    print.error();
  },
});

/**
 * Hook timeout for any `afterEach`/`beforeEach` that resets the mock server.
 * The reset may wait {@link PROXIED_API_SETTLE_TIMEOUT_MS} for in-flight API
 * requests and then truncate the API database, so Bun's 5 s hook default can
 * abandon it halfway: the test fails as an anonymous hook timeout and the next
 * test inherits unreset state. This bound lets the reset finish, or fail with
 * its own diagnostic.
 */
export const MOCK_SERVER_RESET_TIMEOUT_MS = PROXIED_API_SETTLE_TIMEOUT_MS * 2;

export async function resetMockServer(
  options: ResetMockServerOptions = {},
): Promise<void> {
  await drainSocketClients();
  await waitForProxiedApiRequestsToSettle(
    options.proxiedApiTimeoutMs,
    options.proxiedApiQuietMs,
  );
  await resetTestApiDatabase();
  forgetTestApiApp();
  resetMockAuth();
  eventRouter.clear();
  clearProxiedApiRequests();
  server.resetHandlers();
}

export function useTestApiAppHandlers(options: TestApiAppHandlerOptions = {}) {
  server.use(
    http.all("http://localhost:3001/*", async ({ request }) =>
      proxyRequestToApiApp(request, options),
    ),
  );
}

afterAll(async () => {
  await resetMockServer();
});
