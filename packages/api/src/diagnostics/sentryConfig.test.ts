import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { sanitizeSentryEvent } from "@tearleads/diagnostics/privacy";
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
    { sourceRoot: "" },
  ])
    expect(resolveApiSentryConfig({ ...input, ...change })).toBeUndefined();
});

test("Worker builds admit only their exact bundle, without widening frame privacy", async () => {
  const apiRoot = resolve(import.meta.dirname, "../..");
  const wrangler = Bun.JSONC.parse(
    await Bun.file(resolve(apiRoot, "wrangler.jsonc")).text(),
  );
  expect(wrangler).toMatchObject({ main: "./src/worker/index.ts" });
  const definitions = execFileSync(
    process.execPath,
    ["scripts/workerDefines.ts"],
    { cwd: apiRoot, encoding: "utf8" },
  );
  const prefix = "API_DIAGNOSTICS_BUILD:";
  const definition = definitions
    .split("\n")
    .find((line) => line.startsWith(prefix));
  if (!definition)
    throw new Error("Missing Worker diagnostics build definition");
  const config = resolveApiSentryConfig({
    ...JSON.parse(definition.slice(prefix.length)),
    dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
    environment: "production",
  });
  if (!config) throw new Error("Expected build config");
  expect([...(config.scriptPaths ?? [])]).toEqual(["/index.js"]);
  const event = sanitizeSentryEvent(
    {
      tags: { diagnostic_source: "request-error" },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                "index.js",
                "another.js",
                "index.js?secret",
                "index.js#secret",
                "file:///private/index.js",
                "/private/index.js",
                "https://private/index.js",
                "packages/api/src/routeApp.ts",
              ].map((filename) => ({
                filename,
                lineno: 12,
                colno: 4,
                function: "private",
                vars: { secret: "private" },
              })),
            },
          },
        ],
      },
    },
    config,
  );
  expect(event?.exception?.values?.[0]?.stacktrace?.frames).toEqual([
    { filename: "app:///index.js", lineno: 12, colno: 4, in_app: true },
  ]);
});
