import { expect, test } from "bun:test";
import { sanitizeSentryEvent } from "@tearleads/diagnostics/privacy";
import { resolveElectrobunMainSentryConfig } from "./mainSentryConfig";

const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;
const root = "/Applications/Tearleads.app/Contents/Resources/app";
const input = {
  dsn,
  environment: "staging",
  commit,
  moduleUrl: `file://${root}/bun/index.js`,
};

test("main config admits only the packaged bun bundle and derives its app root", () => {
  expect(resolveElectrobunMainSentryConfig(input)).toEqual({
    dsn,
    environment: "staging",
    release: `tearleads-electrobun@${commit}`,
    dist: "staging-app",
    runtime: "electrobun-main",
    origin: "",
    scriptPath: "",
    serverSourceRoot: root,
    scriptPaths: new Set(["/bun/index.js"]),
    budgetResetMs: 3_600_000,
  });
  expect(
    resolveElectrobunMainSentryConfig({
      ...input,
      moduleUrl:
        "file:///Apps/a%2520b/T.app/Contents/Resources/app/bun/index.js",
    })?.serverSourceRoot,
  ).toBe("/Apps/a b/T.app/Contents/Resources/app");
});

test("main config fails closed", () => {
  for (const override of [
    { dsn: undefined },
    { dsn: "https://public@sentry.example.test/1" },
    { environment: "dev" },
    { commit: "abcdef1" },
    { moduleUrl: "file:///var/folders/x/electrobun-1-abc.js" },
    { moduleUrl: `file://${root}/src/bun/index.ts` },
    { moduleUrl: `file://${root}/bun/main.js` },
    { moduleUrl: "https://x/bun/index.js" },
    { moduleUrl: "not a url" },
  ])
    expect(
      resolveElectrobunMainSentryConfig({ ...input, ...override }),
    ).toBeUndefined();
});

test("main frames admit only the packaged bundle", () => {
  const config = resolveElectrobunMainSentryConfig(input);
  if (!config) throw new Error("Expected a main-process configuration");
  const event = sanitizeSentryEvent(
    {
      tags: { diagnostic_source: "request-error" },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: `${root}/bun/index.js`, lineno: 4, colno: 26 },
                { filename: "native", lineno: 1, colno: 1 },
                { filename: `${root}/src/bun/index.ts`, lineno: 4, colno: 21 },
                { filename: `${root}-evil/bun/index.js`, lineno: 1, colno: 1 },
                {
                  filename: "/var/folders/x/electrobun-1.js",
                  lineno: 1,
                  colno: 1,
                },
                { filename: `${root}/bun/index.js.map`, lineno: 1, colno: 1 },
                { filename: "bun/index.js", lineno: 1, colno: 1 },
                { filename: "./bun/index.js", lineno: 1, colno: 1 },
                { filename: "app:///bun/index.js", lineno: 1, colno: 1 },
              ],
            },
          },
        ],
      },
    },
    config,
  );
  expect(event?.exception?.values?.[0]?.stacktrace?.frames).toEqual([
    { filename: "app:///bun/index.js", lineno: 4, colno: 26, in_app: true },
  ]);
  expect(JSON.stringify(event)).not.toContain(root);
});
