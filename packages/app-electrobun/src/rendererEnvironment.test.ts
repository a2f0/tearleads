import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { createRendererEnvironmentDefines } from "./rendererEnvironment";

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
