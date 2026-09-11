import { expect, test } from "bun:test";
import { sanitizeSentryEvent } from "@tearleads/diagnostics/privacy";
import {
  type ElectrobunSentryInput,
  resolveElectrobunSentryConfig,
} from "./sentryConfig";

const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;
// The renderer's pinned loopback origin and bundle path; see src/bun/index.ts.
const origin = "http://127.0.0.1:3002";
const input: ElectrobunSentryInput = {
  dsn,
  environment: "staging",
  commit,
  origin,
  scriptUrl: `${origin}/chunk-abc123.js`,
};

test("desktop config selects its own release, tier, and served renderer chunk", () => {
  expect(resolveElectrobunSentryConfig(input)).toEqual({
    dsn,
    origin,
    scriptPath: "/chunk-abc123.js",
    environment: "staging",
    release: `tearleads-electrobun@${commit}`,
    dist: "staging-app",
  });
  expect(
    resolveElectrobunSentryConfig({ ...input, environment: "production" })
      ?.dist,
  ).toBe("production-app");
});

test("desktop config fails closed on every missing or malformed input", () => {
  for (const change of [
    // An unconfigured build — including every dev build, whose renderer defines
    // omit these entirely — reports nothing.
    { dsn: undefined },
    { dsn: "" },
    { dsn: "https://attacker.invalid/1" },
    { dsn: "not-a-url" },
    { environment: undefined },
    { environment: "dev" },
    { commit: undefined },
    { commit: "unknown" },
    { commit: commit.toUpperCase() },
    { scriptUrl: "chunk-abc123.js" },
    { scriptUrl: "https://app.tearleads.com/chunk-abc123.js" },
    { scriptUrl: "http://127.0.0.1:3000/chunk-abc123.js" },
    { scriptUrl: `${origin}/assets/chunk-abc123.js` },
    { scriptUrl: `${origin}/index.html` },
  ]) {
    expect(
      resolveElectrobunSentryConfig({ ...input, ...change }),
    ).toBeUndefined();
  }
});

test("desktop errors retain only the served chunk and approved activity", () => {
  const config = resolveElectrobunSentryConfig(input);
  if (!config) throw new Error("Expected configured desktop diagnostics");
  const secret = "SYNTHETIC_PRIVATE_CONTACT";
  const event = sanitizeSentryEvent(
    {
      tags: { diagnostic_source: "log", area: "explorer" },
      exception: {
        values: [
          {
            type: "TypeError",
            value: secret,
            stacktrace: {
              frames: [
                // A WKWebView/CEF stack also carries extension, devtools, and
                // on-disk frames that never belong in a report.
                { filename: `chrome-extension://id/${secret}.js`, lineno: 1 },
                { filename: `file:///Users/${secret}/worker.js`, lineno: 2 },
                { filename: `${origin}/chunk-${secret}.js`, lineno: 3 },
                {
                  filename: `${origin}/chunk-abc123.js?${secret}`,
                  lineno: 4,
                  function: secret,
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: "app.activity",
          data: { area: "explorer", action: "move-to-trash", name: secret },
        },
        { category: "console", message: secret },
      ],
    },
    config,
  );
  expect(event?.exception?.values?.[0]?.stacktrace?.frames).toEqual([
    { filename: "app:///chunk-abc123.js", lineno: 4, in_app: true },
  ]);
  expect(event?.breadcrumbs).toEqual([
    {
      category: "app.activity",
      level: "info",
      data: { area: "explorer", action: "move-to-trash" },
    },
  ]);
  expect(JSON.stringify(event)).not.toContain(secret);
});
