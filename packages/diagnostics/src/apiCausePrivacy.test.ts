import { expect, spyOn, test } from "bun:test";
import type { SentryConfig } from "./config";
import { createServerDiagnostics } from "./server";

const secret = "SYNTHETIC_PRIVATE_SQL_TOKEN_PARAMETER";
const config: SentryConfig = {
  dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
  environment: "staging",
  release: `tearleads-api@${"b".repeat(40)}`,
  dist: "staging",
  origin: "",
  scriptPath: "",
  runtime: "api",
  serverSourceRoot: "/build",
  scriptPaths: new Set(["/index.js"]),
  routeTemplates: new Set(["/documents/{documentId}"]),
};

test("both privacy passes keep cause locations, pool counters, and registered route templates", async () => {
  const bodies: string[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_url: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return new Response(null, { status: 200 });
      },
      { preconnect: () => {} },
    ),
  );
  const diagnostics = createServerDiagnostics(config);
  const cause = new Error(secret);
  cause.stack = `Error: ${secret}\n at ${secret} (/build/index.js:12:3)\n at ${secret} (/private/${secret}.js:1:1)`;
  const error = Object.assign(new Error(secret, { cause }), {
    name: "PostgresConnectionError",
    code: "PG_CONNECT_TIMEOUT",
    databaseStage: "connect",
    connectionAttempts: 2,
    poolTotal: 4,
    poolIdle: 0,
    poolWaiting: 3,
    query: secret,
    credentials: secret,
  });
  error.stack = `Error: ${secret}\n at ${secret} (/build/index.js:30:4)`;
  try {
    diagnostics.captureError(error, "request-error", undefined, {
      route: "/documents/{documentId}",
      method: "POST",
      status: 503,
    });
    await diagnostics.flush();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain(secret);
    const event = JSON.parse(bodies[0]?.split("\n")[2] ?? "{}");
    expect(event.tags).toMatchObject({
      privacy: "api-allowlist-v3",
      api_error_code: "PG_CONNECT_TIMEOUT",
      api_database_stage: "connect",
      api_connection_attempts: "2",
      api_pool_total: "4",
      api_pool_idle: "0",
      api_pool_waiting: "3",
      api_route: "/documents/{documentId}",
      api_method: "POST",
      api_response_status: "503",
    });
    expect(
      event.exception.values.map(
        (value: { stacktrace: { frames: unknown[] } }) =>
          value.stacktrace.frames,
      ),
    ).toEqual([
      [{ filename: "app:///index.js", lineno: 12, colno: 3, in_app: true }],
      [{ filename: "app:///index.js", lineno: 30, colno: 4, in_app: true }],
    ]);
    expect(event.exception.values.at(-1).type).toBe("PostgresConnectionError");
    expect(event.request).toBeUndefined();
    expect(event.contexts).toBeUndefined();
  } finally {
    await diagnostics.close();
    fetchSpy.mockRestore();
  }
});
