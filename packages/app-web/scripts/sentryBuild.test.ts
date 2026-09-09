import { expect, test } from "bun:test";
import { assertSentryBuildOutput } from "./sentryBuild";

const config = {
  dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/11`,
  environment: "staging",
  commit: "b".repeat(40),
  variant: "app",
};
const outputs = [
  "/tmp/dist/index.html",
  "/tmp/dist/chunk-abc123.js",
  "/tmp/dist/chunk-abc123.js.map",
];

test("configured builds validate the actual emitted JavaScript entry", () => {
  expect(() =>
    assertSentryBuildOutput(config, "/tmp/dist", outputs),
  ).not.toThrow();
  for (const scripts of [
    [],
    ["/tmp/dist/index.js"],
    ["/tmp/dist/chunk-ABC123.js"],
    ["/tmp/dist/assets/chunk-abc123.js"],
    ["/tmp/other/chunk-abc123.js"],
    ["/tmp/dist/chunk-abc123.js", "/tmp/dist/chunk-def456.js"],
  ]) {
    expect(() => assertSentryBuildOutput(config, "/tmp/dist", scripts)).toThrow(
      "Invalid Sentry build",
    );
  }
  expect(() =>
    assertSentryBuildOutput(
      { ...config, commit: "shortsha" },
      "/tmp/dist",
      outputs,
    ),
  ).toThrow();
});

test("disabled and demo builds do not require a Sentry-compatible entry", () => {
  expect(() =>
    assertSentryBuildOutput({ ...config, dsn: undefined }, "/tmp/dist", []),
  ).not.toThrow();
  expect(() =>
    assertSentryBuildOutput({ ...config, variant: "demo" }, "/tmp/dist", []),
  ).not.toThrow();
});
