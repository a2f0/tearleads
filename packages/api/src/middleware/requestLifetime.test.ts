import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createRequestLifetimeBindings } from "./requestLifetime";
import { createRequireAuth, type SessionEnv } from "./session";

const TOKEN = "a".repeat(64);
const SESSION = JSON.stringify({
  createdAt: Date.now(),
  fingerprint: "b".repeat(64),
  id: "c".repeat(64),
  ipAddresses: [],
  lastActiveAt: Date.now(),
  lastActiveIp: null,
  userId: "33333333-3333-4333-8333-333333333333",
});

function authenticatedApp(stored: string | null) {
  const app = new Hono<SessionEnv>();
  app.use(
    "*",
    createRequireAuth(
      async () => stored,
      async () => {},
    ),
  );
  return app;
}

test("only an authenticated history route disables its request's idle timeout", async () => {
  for (const stored of [null, "{}", "not-json", SESSION]) {
    const app = authenticatedApp(stored);
    app.get("/history", (c) => {
      c.env?.beginPrincipalHistoryVerification?.();
      return c.text("verified");
    });
    app.get("/ordinary", (c) => c.text("verified"));
    for (const path of ["/ordinary", "/history"]) {
      const request = new Request(`http://localhost${path}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      const overrides: number[] = [];
      const response = await app.fetch(
        request,
        createRequestLifetimeBindings(request, {
          timeout(actual, seconds) {
            expect(actual).toBe(request);
            overrides.push(seconds);
          },
        }),
      );
      expect(response.status).toBe(stored === SESSION ? 200 : 401);
      expect(overrides).toEqual(
        stored === SESSION && path === "/history" ? [0] : [],
      );
    }
  }
});

test("an authenticated history handler can finish silent verification beyond the socket idle deadline", async () => {
  const app = authenticatedApp(SESSION);
  app.get("/", async (c) => {
    c.env?.beginPrincipalHistoryVerification?.();
    await Bun.sleep(5_100);
    return c.text("verified");
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 1,
    fetch: (request, listener) =>
      app.fetch(request, createRequestLifetimeBindings(request, listener)),
  });
  try {
    const response = await fetch(server.url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("verified");
  } finally {
    await server.stop(true);
  }
}, 10_000);
