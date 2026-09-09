import { expect, test } from "bun:test";
import { resolveSentryConfig } from "../src/diagnostics/sentryConfig";

const input = {
  dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/11`,
  environment: "staging",
  commit: "b".repeat(40),
  variant: "app",
  origin: "https://app-staging.tearleads.com",
  scriptUrl: "https://app-staging.tearleads.com/chunk-abc123.js",
};

test("Sentry only activates for an explicitly configured deployed app and known script", () => {
  expect(resolveSentryConfig(input)).toMatchObject({
    environment: "staging",
    dist: "staging-app",
    scriptPath: "/chunk-abc123.js",
  });
  expect(
    resolveSentryConfig({ ...input, environment: "production" })?.dist,
  ).toBe("production-app");
  for (const override of [
    { dsn: undefined },
    { dsn: "https://private@evil.example/1" },
    { environment: "development" },
    { commit: "private-branch-name" },
    { variant: "demo" },
    { scriptUrl: `${input.origin}/private-document.js` },
    { scriptUrl: "https://extension.example/chunk-abc123.js" },
  ])
    expect(resolveSentryConfig({ ...input, ...override })).toBeUndefined();
});
