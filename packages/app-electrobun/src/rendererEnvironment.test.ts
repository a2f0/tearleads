import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  createMainProcessSentryDefine,
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
      "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_TARGET": "undefined",
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
// What Hutch sets while evaluating electrobun.config.ts and running hooks.
const hutchLinux = { ELECTROBUN_OS: "linux", ELECTROBUN_ARCH: "x64" };

test("a dev build cannot inherit desktop Sentry values from the shell", () => {
  // The dev server and electrobun.config.ts read the ambient process
  // environment directly, never the release wrapper, so a developer who had
  // exported a desktop DSN would otherwise report their local session.
  const defines = createRendererEnvironmentDefines({
    ...sentryEnvironment,
    ...hutchLinux,
  });
  for (const name of [
    ...Object.keys(sentryEnvironment),
    "BUN_PUBLIC_SENTRY_ELECTROBUN_TARGET",
  ]) {
    expect(defines[`process.env.${name}`]).toBe("undefined");
  }
  expect(
    createRendererEnvironmentDefines({
      ...sentryEnvironment,
      NODE_ENV: "development",
    })["process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_DSN"],
  ).toBe("undefined");
});

test("the shipped renderer build inlines the desktop Sentry configuration", () => {
  // scripts/packageElectrobunAssets.ts deletes Hutch's view output and rebuilds
  // the packaged renderer through createRendererBuildConfig, so this config —
  // not electrobun.config.ts's defines — is what actually ships. Stripping the
  // Sentry names here would leave desktop reporting permanently unreachable
  // while still looking wired.
  const release = {
    ...sentryEnvironment,
    ...hutchLinux,
    // An inherited value never replaces Hutch's own target.
    BUN_PUBLIC_SENTRY_ELECTROBUN_TARGET: "macos-arm64",
    NODE_ENV: "production",
  };
  const { define } = createRendererBuildConfig(release, "index.html");
  for (const [name, value] of Object.entries({
    ...sentryEnvironment,
    BUN_PUBLIC_SENTRY_ELECTROBUN_TARGET: "linux-x64",
  })) {
    expect(define?.[`process.env.${name}`]).toBe(JSON.stringify(value));
  }
  expect(createRendererEnvironmentDefines(release)).toMatchObject(define ?? {});
});

test("the main-process Sentry define is inlined only for a release build", () => {
  const release = {
    ...sentryEnvironment,
    ...hutchLinux,
    NODE_ENV: "production",
  };
  expect(createMainProcessSentryDefine(release)).toEqual({
    TEARLEADS_ELECTROBUN_MAIN_SENTRY: JSON.stringify({
      commit: sentryEnvironment.BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT,
      dsn: sentryEnvironment.BUN_PUBLIC_SENTRY_ELECTROBUN_DSN,
      environment: "staging",
      target: "linux-x64",
    }),
  });
  expect(createMainProcessSentryDefine(sentryEnvironment)).toEqual({
    TEARLEADS_ELECTROBUN_MAIN_SENTRY: "null",
  });
  expect(
    createMainProcessSentryDefine({
      ...release,
      BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: undefined,
    }),
  ).toEqual({ TEARLEADS_ELECTROBUN_MAIN_SENTRY: "null" });
});

test("a release build for a target without its own dist stops, and any other build ignores the target", () => {
  const release = { ...sentryEnvironment, NODE_ENV: "production" };
  for (const hutch of [
    {},
    { ELECTROBUN_OS: "macos", ELECTROBUN_ARCH: "x64" },
    { ELECTROBUN_OS: "win", ELECTROBUN_ARCH: "arm64" },
  ]) {
    expect(() =>
      createMainProcessSentryDefine({ ...release, ...hutch }),
    ).toThrow(/Desktop Sentry releases support/);
    expect(() =>
      createRendererEnvironmentDefines({ ...release, ...hutch }),
    ).toThrow(/Desktop Sentry releases support/);
    // An unset tier (the wrapper drops every Sentry name) and a dev build stay
    // inert on any target.
    const local = { NODE_ENV: "production", ...hutch };
    expect(createMainProcessSentryDefine(local)).toEqual({
      TEARLEADS_ELECTROBUN_MAIN_SENTRY: "null",
    });
    expect(
      createRendererEnvironmentDefines({ ...sentryEnvironment, ...hutch })[
        "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_TARGET"
      ],
    ).toBe("undefined");
  }
});

test("Windows x64 releases define their own renderer and main-process target", () => {
  const release = {
    ...sentryEnvironment,
    NODE_ENV: "production",
    ELECTROBUN_OS: "win",
    ELECTROBUN_ARCH: "x64",
  };
  expect(
    createRendererEnvironmentDefines(release)[
      "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_TARGET"
    ],
  ).toBe(JSON.stringify("win-x64"));
  const { TEARLEADS_ELECTROBUN_MAIN_SENTRY: mainDefine } =
    createMainProcessSentryDefine(release);
  expect(JSON.parse(mainDefine ?? "null")).toMatchObject({
    target: "win-x64",
    environment: "staging",
  });
});
