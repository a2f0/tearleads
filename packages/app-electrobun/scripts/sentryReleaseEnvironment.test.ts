import { expect, test } from "bun:test";
import {
  desktopSentryReleaseEnvironment,
  desktopSentryUpload,
} from "./sentryReleaseEnvironment";

const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;
const stagingDir = "/pkg/build/sentry-sourcemaps";
const secrets = {
  PATH: "/usr/bin",
  SENTRY_AUTH_TOKEN: "upload-token",
  SENTRY_ELECTROBUN_PRODUCTION_DSN: `https://${"c".repeat(32)}@o1.ingest.us.sentry.io/2`,
  SENTRY_ELECTROBUN_STAGING_DSN: dsn,
};

test("an unset tier builds locally and reports nothing", () => {
  expect(
    desktopSentryReleaseEnvironment(
      { ...secrets, TEARLEADS_ELECTROBUN_SOURCEMAP_DIR: "/inherited" },
      undefined,
      "",
    ),
  ).toEqual({
    PATH: "/usr/bin",
  });
});

test("a configured tier inlines only that tier's public desktop values", () => {
  expect(
    desktopSentryReleaseEnvironment(secrets, "staging", commit, stagingDir),
  ).toEqual({
    PATH: "/usr/bin",
    TEARLEADS_ELECTROBUN_SOURCEMAP_DIR: stagingDir,
    BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT: commit,
    BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: dsn,
    BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: "staging",
  });
  const { BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: productionDsn } =
    desktopSentryReleaseEnvironment(secrets, "production", commit, stagingDir);
  expect(productionDsn).toBe(secrets.SENTRY_ELECTROBUN_PRODUCTION_DSN);
});

test("the upload token and other targets' configuration never reach a build", () => {
  const resolved = desktopSentryReleaseEnvironment(
    {
      ...secrets,
      BUN_PUBLIC_SENTRY_DSN: "https://web@o1.ingest.us.sentry.io/9",
      SENTRY_IOS_STAGING_DSN: `https://${"d".repeat(32)}@o1.ingest.us.sentry.io/3`,
    },
    "staging",
    commit,
    stagingDir,
  );
  expect(Object.values(resolved)).not.toContain("upload-token");
  for (const name of Object.keys(resolved)) {
    expect(name.startsWith("SENTRY_")).toBe(false);
  }
  const {
    BUN_PUBLIC_SENTRY_DSN: webDsn,
    BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: desktopDsn,
  } = resolved;
  expect(webDsn).toBeUndefined();
  expect(desktopDsn).toBe(dsn);
});

test("a configured tier that cannot report stops the build", () => {
  // Shipping a desktop release that looks instrumented and silently reports
  // nothing is worse than failing the build that produced it.
  for (const [tier, env, buildCommit] of [
    ["nightly", secrets, commit],
    ["staging", { PATH: "/usr/bin" }, commit],
    ["staging", { SENTRY_ELECTROBUN_STAGING_DSN: "not-a-dsn" }, commit],
    ["staging", secrets, "abcdef1"],
    ["staging", secrets, ""],
  ] as const) {
    expect(() =>
      desktopSentryReleaseEnvironment(env, tier, buildCommit, stagingDir),
    ).toThrow();
  }
});

test("a configured tier without a staging directory stops the build", () => {
  expect(() =>
    desktopSentryReleaseEnvironment(secrets, "staging", commit),
  ).toThrow(/source-map staging directory/);
});

test("a configured tier without upload credentials stops before building", () => {
  const upload = {
    SENTRY_ORG: "tearleads",
    SENTRY_ELECTROBUN_STAGING_PROJECT: "tearleads-electrobun-staging",
    SENTRY_AUTH_TOKEN: "upload-token",
  };
  for (const [tier, env] of [
    ["staging", { ...upload, SENTRY_ORG: undefined }],
    ["staging", { ...upload, SENTRY_ELECTROBUN_STAGING_PROJECT: undefined }],
    ["staging", { ...upload, SENTRY_AUTH_TOKEN: undefined }],
    ["nightly", upload],
  ] as const) {
    expect(() => desktopSentryUpload(env, tier)).toThrow();
  }
  expect(desktopSentryUpload(upload, "staging")).toEqual({
    org: "tearleads",
    project: "tearleads-electrobun-staging",
    token: "upload-token",
    environment: "staging",
  });
});
