import { expect, test } from "bun:test";
import { createStackParser } from "@sentry/core";
import { nodeStackLineParser } from "@sentry/core/server";
import { apiErrorTags } from "./apiDiagnostics";
import { type SentryPrivacyConfig, sanitizeSentryEvent } from "./privacy";
import { sanitizeServerEvent } from "./serverEvent";

const config: SentryPrivacyConfig = {
  environment: "production",
  release: "synthetic",
  dist: "production",
  runtime: "api",
  origin: "",
  scriptPath: "",
  serverSourceRoot: "app://",
  scriptPaths: new Set(["/index.js"]),
  routeTemplates: new Set(["/documents/{documentId}"]),
};

test("forged identifiers, route values, counters, and causes cannot expand the allowlist", () => {
  const secret = "SYNTHETIC_PRIVATE";
  const safe = sanitizeSentryEvent(
    {
      tags: {
        diagnostic_source: "request-error",
        api_route: `/documents/${secret}`,
        api_method: secret,
        api_response_status: secret,
        api_database_stage: "connect",
        api_pool_total: secret,
        api_pool_idle: "-1",
        api_pool_waiting: "1.5",
        api_connection_attempts: "10001",
      },
      exception: {
        values: Array.from({ length: 8 }, () => ({
          type: secret,
          value: secret,
          mechanism: { type: secret, data: { secret } },
          stacktrace: {
            frames: [
              {
                filename: "app:///index.js",
                lineno: 12,
                function: secret,
                vars: { secret },
                pre_context: [secret],
              },
            ],
          },
        })),
      },
    },
    config,
  );
  expect(JSON.stringify(safe)).not.toContain(secret);
  expect(safe?.exception?.values).toHaveLength(5);
  expect(safe?.tags).toEqual({
    area: "api",
    diagnostic_source: "request-error",
    privacy: "api-allowlist-v3",
    api_operation: "http.request",
    api_database_stage: "connect",
  });
  expect(sanitizeSentryEvent(safe ?? {}, config)).toEqual(safe);
  const browserConfig = { ...config };
  delete browserConfig.runtime;
  const client = sanitizeSentryEvent(
    { ...safe, tags: { diagnostic_source: "boundary" } },
    browserConfig,
  );
  expect(client?.exception?.values).toHaveLength(1);
  expect(client?.tags).not.toHaveProperty("api_database_stage");
});

test("cyclic causes are bounded and cause getters are never invoked", () => {
  const error = new Error("private");
  error.cause = error;
  expect(apiErrorTags(error)).toEqual({});
  Object.defineProperty(error, "cause", {
    get() {
      throw new Error("getter executed");
    },
  });
  const parsed = sanitizeServerEvent(
    { tags: { diagnostic_source: "request-error" } },
    config,
    createStackParser(nodeStackLineParser()),
    null,
    error,
  );
  expect(parsed?.tags).toHaveProperty("api_stack", "unavailable");
  expect(apiErrorTags(error)).toEqual({});
});
