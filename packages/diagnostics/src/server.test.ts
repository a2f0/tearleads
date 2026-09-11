import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { createSentryEventBudget } from "./budget";
import type { SentryConfig } from "./config";
import { sanitizeSentryEvent } from "./privacy";
import { createServerDiagnostics } from "./server";

const secret = "SYNTHETIC_PRIVATE_SQL_PASSWORD_DOCUMENT";
const config: SentryConfig = {
  dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
  environment: "staging",
  release: `tearleads-api@${"b".repeat(40)}`,
  dist: "staging",
  origin: "",
  scriptPath: "",
  scriptPaths: new Set(["/packages/api/src/routeApp.ts"]),
  serverSourceRoot: "/build/tearleads",
  runtime: "api",
  budgetResetMs: 3600000,
};
afterEach(() => setSystemTime());

test("an empty source root cannot admit a foreign frame through an empty script path", () => {
  const event = sanitizeSentryEvent(
    {
      tags: { diagnostic_source: "request-error" },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: `https://foreign.invalid/${secret}`, lineno: 1 },
              ],
            },
          },
        ],
      },
    },
    { ...config, serverSourceRoot: "" },
  );
  expect(event?.exception?.values?.[0]?.stacktrace).toBeUndefined();
  expect(JSON.stringify(event)).not.toContain(secret);
});

test("API SDK sends only sanitized errors with exact source frames and isolated scopes", async () => {
  const requests: RequestInit[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        requests.push(args[1] ?? {});
        return new Response(null, { status: 200 });
      },
      { preconnect: () => {} },
    ),
  );
  const client = createServerDiagnostics(config);
  try {
    const error = Object.assign(
      new TypeError(secret, { cause: new Error(secret) }),
      { query: secret, parameters: [secret] },
    );
    error.stack = `TypeError: ${secret}\n    at ${secret} (/build/tearleads/packages/api/src/routeApp.ts:12:8)\n    at ${secret} (/users/${secret}.ts:2:1)`;
    client.captureError(error, "request-error");
    const next = new Error(secret);
    next.stack = `Error: ${secret}\n    at packages/api/src/routeApp.ts:30:4`;
    client.captureError(next, "websocket-error");
    await client.flush();
    expect(requests).toHaveLength(2);
    for (const [index, request] of requests.entries()) {
      const body = String(request.body);
      expect(body).not.toContain(secret);
      expect(request.credentials).toBe("omit");
      const event = JSON.parse(body.trim().split("\n")[2] ?? "{}");
      expect(event.exception.values[0].stacktrace.frames).toEqual([
        {
          filename: "app:///packages/api/src/routeApp.ts",
          lineno: index === 0 ? 12 : 30,
          colno: index === 0 ? 8 : 4,
          in_app: true,
        },
      ]);
      expect(event.tags.diagnostic_source).toBe(
        index === 0 ? "request-error" : "websocket-error",
      );
      expect(event.user).toEqual({ ip_address: "0.0.0.0" });
      expect(event.breadcrumbs).toEqual([]);
      for (const field of [
        "request",
        "extra",
        "contexts",
        "server_name",
        "sdk",
        "transaction",
        "modules",
      ])
        expect(event[field]).toBeUndefined();
    }
  } finally {
    await client.close();
    fetchSpy.mockRestore();
  }
});

test("swallowed background failures are admitted as handled and never as a crash", () => {
  const sanitize = (source: string) =>
    sanitizeSentryEvent({ tags: { diagnostic_source: source } }, config);
  for (const source of ["background-error", "request-error"]) {
    const event = sanitize(source);
    expect(event?.tags).toMatchObject({ diagnostic_source: source });
    // An unhandled mechanism would be triaged as a crash; these were swallowed.
    expect(event?.exception?.values?.[0]?.mechanism).toEqual({
      type: "generic",
      handled: true,
    });
  }
  // Browser-only sources stay unknown to the API runtime and are dropped whole.
  expect(sanitize("log")).toBeNull();
});

test("API budget resets after an hour so a long-lived server can report recurring failures", () => {
  const start = Date.now();
  setSystemTime(start);
  const admit = createSentryEventBudget(3600000);
  const event = sanitizeSentryEvent(
    {
      tags: { diagnostic_source: "request-error" },
      breadcrumbs: [
        {
          category: "app.activity",
          data: { area: "explorer", action: "open" },
        },
      ],
    },
    config,
  );
  expect(event?.breadcrumbs).toEqual([]);
  if (!event) throw new Error("Expected sanitized event");
  expect(admit(event)).toBe(true);
  setSystemTime(start + 60000);
  expect(admit(event)).toBe(false);
  setSystemTime(start + 3600000);
  expect(admit(event)).toBe(true);
});
