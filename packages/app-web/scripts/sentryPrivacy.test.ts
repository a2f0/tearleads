import { expect, test } from "bun:test";
import type { Event } from "@sentry/browser";
import {
  type SentryPrivacyConfig,
  sanitizeBreadcrumb,
  sanitizeSentryEvent,
} from "@tearleads/diagnostics/privacy";

const secret = "private-document-key-person@example.test";
const config: SentryPrivacyConfig = {
  origin: "https://app.tearleads.com",
  scriptPath: "/chunk-abc123.js",
  environment: "production",
  release: `tearleads-web@${"a".repeat(40)}`,
  dist: "production-app",
};
function event(): Event {
  return {
    event_id: "b".repeat(32),
    message: secret,
    logentry: { message: secret },
    transaction: secret,
    user: { id: secret, email: secret, ip_address: "192.0.2.1" },
    request: {
      url: `${config.origin}/${secret}`,
      headers: { Authorization: secret },
      cookies: { session: secret },
      data: secret,
    },
    contexts: {
      trace: { trace_id: secret, span_id: secret },
      document: { text: secret },
    },
    extra: { secret },
    tags: { area: "explorer", diagnostic_source: "boundary", secret },
    fingerprint: [secret],
    server_name: secret,
    exception: {
      values: [
        {
          type: secret,
          value: secret,
          mechanism: { type: secret, data: { secret } },
          stacktrace: {
            frames: [
              {
                filename: `${config.origin}/chunk-abc123.js?token=${secret}#${secret}`,
                function: secret,
                context_line: secret,
                vars: { secret },
                pre_context: [secret],
                post_context: [secret],
                lineno: 12,
                colno: 45,
              },
              { filename: `https://extension.example/${secret}`, lineno: 1 },
            ],
          },
        },
        {
          type: "Error",
          value: secret,
        },
      ],
    },
    breadcrumbs: [
      { category: "console", message: secret },
      { category: "navigation", data: { to: secret } },
      {
        category: "app.activity",
        message: secret,
        data: { area: "explorer", action: "move-to-trash", secret },
        timestamp: 10,
      },
    ],
  };
}

test("events contain only static categories, generated code positions, release and safe breadcrumbs", () => {
  const safe = sanitizeSentryEvent(event(), config);
  expect(safe).not.toBeNull();
  expect(JSON.stringify(safe)).not.toContain(secret);
  expect(safe?.exception?.values).toEqual([
    {
      type: "Error",
      value: "Application error (message omitted)",
      stacktrace: {
        frames: [
          {
            filename: "app:///chunk-abc123.js",
            lineno: 12,
            colno: 45,
            in_app: true,
          },
        ],
      },
      mechanism: { type: "generic", handled: true },
    },
  ]);
  expect(safe?.breadcrumbs).toEqual([
    {
      category: "app.activity",
      level: "info",
      timestamp: 10,
      data: { area: "explorer", action: "move-to-trash" },
    },
  ]);
  expect(safe?.user).toEqual({ ip_address: "0.0.0.0" });
  expect(safe?.request).toBeUndefined();
  expect(safe?.contexts).toBeUndefined();
  expect(safe?.extra).toBeUndefined();
  expect(safe?.fingerprint).toBeUndefined();
  expect(sanitizeSentryEvent(safe ?? {}, config)).toEqual(safe);
});

test("anonymous DevTools, extension, route URL and string-only errors are discarded", () => {
  for (const filename of [
    "",
    "VM83",
    "<anonymous>",
    "chrome-extension://abc/script.js",
    `${config.origin}/${secret}`,
    `${config.origin}/chunk-${secret}.js`,
    `${config.origin}/chunk-aabbccddeeff00112233445566778899.js`,
  ]) {
    const input = event();
    input.tags = { diagnostic_source: "unhandled-error" };
    input.exception = {
      values: [{ stacktrace: { frames: [{ filename, lineno: 2 }] } }],
    };
    expect(sanitizeSentryEvent(input, config)).toBeNull();
  }
  expect(sanitizeSentryEvent({ message: secret }, config)).toBeNull();
  expect(
    sanitizeSentryEvent({ ...event(), type: "transaction" }, config),
  ).toBeNull();
});

test("untrusted breadcrumb names and data are rejected and the trail is bounded", () => {
  expect(
    sanitizeBreadcrumb({
      category: "app.activity",
      data: { area: secret, action: "open" },
    }),
  ).toBeNull();
  expect(
    sanitizeBreadcrumb({
      category: "app.activity",
      data: { area: "notes", action: secret },
    }),
  ).toBeNull();
  const input = event();
  input.breadcrumbs = Array.from({ length: 100 }, () => ({
    category: "app.activity",
    data: { area: "notes", action: "navigate" },
  }));
  expect(sanitizeSentryEvent(input, config)?.breadcrumbs).toHaveLength(30);
});
