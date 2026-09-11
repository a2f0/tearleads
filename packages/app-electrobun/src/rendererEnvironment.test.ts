import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  createRendererBuildConfig,
  createRendererEnvironmentDefines,
} from "./rendererEnvironment";

function evaluateRendererEnvironment(
  environment: Record<string, string | undefined>,
) {
  const transpiler = new Bun.Transpiler({
    define: createRendererEnvironmentDefines(environment),
    loader: "js",
    target: "browser",
  });
  const code = transpiler.transformSync(`globalThis.rendererEnvironment = {
    api: process.env.BUN_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
    ws: process.env.BUN_PUBLIC_WS_URL,
    version: process.env.BUN_PUBLIC_APP_VERSION ?? "unknown",
    commit: process.env.BUN_PUBLIC_GIT_SHA ?? "unknown",
  };`);
  // A WebView has no Node process global. Unreplaced reads must fail here.
  return runInNewContext(code, {});
}

test("an unset desktop environment uses its defaults without Node globals", () => {
  expect(evaluateRendererEnvironment({})).toEqual({
    api: "http://localhost:3001",
    ws: undefined,
    version: "unknown",
    commit: "unknown",
  });
});

test("desktop build overrides remain literal strings in the browser", () => {
  expect(
    evaluateRendererEnvironment({
      BUN_PUBLIC_API_BASE_URL: "https://api.example.test",
      BUN_PUBLIC_WS_URL: "wss://api.example.test/events",
      BUN_PUBLIC_APP_VERSION: 'release-"quoted"',
      BUN_PUBLIC_GIT_SHA: "abcdef1",
    }),
  ).toEqual({
    api: "https://api.example.test",
    ws: "wss://api.example.test/events",
    version: 'release-"quoted"',
    commit: "abcdef1",
  });
});

test("renderer build config applies the public environment defines", () => {
  expect(
    createRendererBuildConfig(
      { BUN_PUBLIC_API_BASE_URL: "https://api.example.test" },
      "renderer.html",
    ),
  ).toEqual({
    define: {
      "process.env.BUN_PUBLIC_API_BASE_URL": '"https://api.example.test"',
      "process.env.BUN_PUBLIC_APP_VERSION": "undefined",
      "process.env.BUN_PUBLIC_GIT_SHA": "undefined",
      "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT": "undefined",
      "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_DSN": "undefined",
      "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT": "undefined",
      "process.env.BUN_PUBLIC_WS_URL": "undefined",
    },
    entrypoints: ["renderer.html"],
    format: "esm",
    target: "browser",
  });
});

const sentryEnvironment = {
  BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT: "b".repeat(40),
  BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
  BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: "staging",
};

test("the shipped renderer build inlines the desktop Sentry configuration", () => {
  // scripts/packageElectrobunAssets.ts deletes Hutch's view output and rebuilds
  // the packaged renderer through createRendererBuildConfig, so this config —
  // not electrobun.config.ts's defines — is what actually ships. Stripping the
  // Sentry names here would leave desktop reporting permanently unreachable
  // while still looking wired.
  const { define } = createRendererBuildConfig(sentryEnvironment, "index.html");
  for (const [name, value] of Object.entries(sentryEnvironment)) {
    expect(define?.[`process.env.${name}`]).toBe(JSON.stringify(value));
  }
  expect(createRendererEnvironmentDefines(sentryEnvironment)).toMatchObject(
    define ?? {},
  );
});
