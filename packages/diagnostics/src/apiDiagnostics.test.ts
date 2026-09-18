import { afterEach, expect, spyOn, test } from "bun:test";
import { createStackParser, nodeStackLineParser } from "@sentry/core";
import { apiErrorTags } from "./apiDiagnostics";
import type { SentryConfig } from "./config";
import { sanitizeSentryEvent } from "./privacy";
import { createServerDiagnostics } from "./server";
import { sanitizeServerEvent } from "./serverEvent";
import { createPrivateSentryTransport } from "./transport";

const secret = "SYNTHETIC_PRIVATE_PASSWORD_SQL_TOKEN_ID";
const config: SentryConfig = {
  dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
  environment: "staging",
  release: `tearleads-api@${"b".repeat(40)}`,
  dist: "staging",
  origin: "",
  scriptPath: "",
  runtime: "api",
  serverSourceRoot: "/build/tearleads",
  scriptPaths: new Set(["/packages/api/src/realtime/realtimeGateway.ts"]),
};
const requests: RequestInit[] = [];
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
function recordRequests() {
  requests.length = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_url: unknown, init?: RequestInit) => {
        requests.push(init ?? {});
        return new Response(null, { status: 200 });
      },
      { preconnect: () => {} },
    ),
  );
}
afterEach(() => fetchSpy?.mockRestore());

test.each(["staging", "production"] as const)(
  "%s exports useful API titles and nested codes without error text",
  async (environment) => {
    recordRequests();
    const client = createServerDiagnostics({
      ...config,
      environment,
      dist: environment,
    });
    const cause = Object.assign(new Error(secret), {
      code: "ECONNREFUSED",
      statusCode: 503,
    });
    const error = Object.assign(new Error(secret, { cause }), {
      name: "DrizzleQueryError",
      code: secret,
      query: secret,
      parameters: [secret],
    });
    error.stack = `Error: ${secret}\n    at connect (node:net:1182:12)`;
    try {
      client.captureError(error, "background-error", "websocket.revalidate");
      await client.flush();
      expect(requests).toHaveLength(1);
      const body = String(requests[0]?.body);
      expect(body).not.toContain(secret);
      const event = JSON.parse(body.trim().split("\n")[2] ?? "{}");
      expect(event.exception.values[0].value).toBe(
        "API WebSocket interest revalidation failed: connection refused (ECONNREFUSED) [HTTP 503]",
      );
      expect(event.exception.values[0].type).toBe("DrizzleQueryError");
      expect(event.tags).toMatchObject({
        api_operation: "websocket.revalidate",
        api_error_code: "ECONNREFUSED",
        api_stack: "unavailable",
        privacy: "api-allowlist-v2",
      });
      expect(event.environment).toBe(environment);
      expect(event.request).toBeUndefined();
      expect(event.extra).toBeUndefined();
    } finally {
      await client.close();
    }
  },
);

test("only allowlisted capture-site frames survive when a driver has no application stack", () => {
  const event = {
    tags: { diagnostic_source: "background-error" },
    exception: {
      values: [
        {
          type: "Error",
          value: secret,
          stacktrace: { frames: [{ filename: "node:net", lineno: 12 }] },
        },
      ],
    },
  };
  const captureSite = new Error(secret);
  captureSite.stack = `Error: ${secret}\n    at ${secret} (/build/tearleads/packages/api/src/realtime/realtimeGateway.ts:30:4)\n    at foreign (/users/${secret}.ts:3:1)`;
  const parser = createStackParser(nodeStackLineParser());
  const safe = sanitizeServerEvent(event, config, parser, captureSite);
  expect(safe?.tags).toMatchObject({ api_stack: "capture-site" });
  expect(safe?.exception?.values?.[0]?.stacktrace?.frames).toEqual([
    {
      filename: "app:///packages/api/src/realtime/realtimeGateway.ts",
      lineno: 30,
      colno: 4,
      in_app: true,
    },
  ]);
  expect(JSON.stringify(safe)).not.toContain(secret);
  const secondPass = sanitizeSentryEvent(safe ?? {}, {
    ...config,
    serverSourceRoot: "app://",
  });
  expect(secondPass).toEqual(safe);
  const withOriginal = {
    ...event,
    exception: {
      values: [
        {
          stacktrace: {
            frames: [
              {
                filename: "packages/api/src/realtime/realtimeGateway.ts",
                lineno: 42,
              },
            ],
          },
        },
      ],
    },
  };
  expect(
    sanitizeServerEvent(withOriginal, config, parser, captureSite)?.tags,
  ).toMatchObject({ api_stack: "original" });
});

test("transport rejects forged API metadata and does not admit arbitrary messages or types", async () => {
  recordRequests();
  const transport = createPrivateSentryTransport(config)({
    url: "https://o1.ingest.us.sentry.io/api/1/envelope/",
    recordDroppedEvent: () => {},
  });
  await transport.send([
    { event_id: "c".repeat(32), sent_at: new Date().toISOString() },
    [
      [
        { type: "event" },
        {
          tags: {
            diagnostic_source: "request-error",
            api_operation: secret,
            api_error_code: "toString",
            api_error_status: `503${secret}`,
            api_cause_type: secret,
            api_stack: secret,
            private: secret,
          },
          exception: { values: [{ type: secret, value: secret }] },
          request: { url: secret, data: secret },
          extra: { secret },
        },
      ],
    ],
  ]);
  await transport.flush(2000);
  const body = String(requests[0]?.body);
  expect(body).not.toContain(secret);
  expect(body).not.toContain("toString");
  const event = JSON.parse(body.trim().split("\n")[2] ?? "{}");
  expect(event.exception.values[0]).toMatchObject({
    type: "Error",
    value: "API HTTP request failed",
  });
  expect(event.tags).toEqual({
    area: "api",
    diagnostic_source: "request-error",
    privacy: "api-allowlist-v2",
    api_operation: "http.request",
  });
});

test("browser and desktop privacy stay on their original policy", () => {
  const { runtime: _runtime, ...browserConfig } = config;
  for (const runtime of [undefined, "electrobun-main"] as const) {
    const safe = sanitizeSentryEvent(
      {
        tags: {
          diagnostic_source: runtime ? "background-error" : "boundary",
          api_operation: "websocket.revalidate",
          api_error_code: "ECONNREFUSED",
        },
        exception: { values: [{ type: "DrizzleQueryError", value: secret }] },
      },
      { ...browserConfig, ...(runtime ? { runtime } : {}) },
    );
    expect(safe?.tags).toMatchObject({ privacy: "allowlist-v1" });
    expect(safe?.tags).not.toHaveProperty("api_error_code");
    expect(safe?.exception?.values?.[0]).toMatchObject({
      type: "Error",
      value: "Application error (message omitted)",
    });
  }
});

test("classification bounds cyclic causes and ignores error getters", () => {
  const error = Object.assign(new Error(secret), { code: "ECONNRESET" });
  error.cause = error;
  Object.defineProperty(error, "status", {
    get() {
      throw new Error("must not execute");
    },
  });
  expect(apiErrorTags(error)).toEqual({ api_error_code: "ECONNRESET" });
});

test("unrelated frameless operations survive deduplication while repeats stay bounded", async () => {
  recordRequests();
  const client = createServerDiagnostics(config);
  try {
    for (const operation of [
      "websocket.revalidate",
      "realtime.publish",
      "websocket.revalidate",
    ] as const) {
      const error = Object.assign(new Error(secret), { code: "ECONNREFUSED" });
      error.stack = `Error: ${secret}\n    at connect (node:net:12:1)`;
      client.captureError(error, "background-error", operation);
    }
    await client.flush();
    expect(requests).toHaveLength(2);
  } finally {
    await client.close();
  }
});
