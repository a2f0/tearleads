import { expect, test } from "bun:test";
import { resolveApiSentryConfig } from "./sentryConfig";

test("API diagnostics require a hosted DSN, explicit tier, and compiled commit", () => {
  const input = {
    dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
    environment: "production",
    commit: "b".repeat(40),
    sourceRoot: "/build",
    sourcePaths: ["/packages/api/src/index.ts"],
  };
  expect(resolveApiSentryConfig(input)?.release).toBe(
    `tearleads-api@${input.commit}`,
  );
  for (const change of [
    { dsn: undefined },
    { dsn: "https://attacker.invalid/1" },
    { environment: "prod" },
    { commit: "unknown" },
  ])
    expect(resolveApiSentryConfig({ ...input, ...change })).toBeUndefined();
});
