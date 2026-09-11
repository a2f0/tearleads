import { expect, test } from "bun:test";
import { desktopSentryReleaseEnvironment } from "./sentryReleaseEnvironment";

const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;
const secrets = {
  PATH: "/usr/bin",
  SENTRY_AUTH_TOKEN: "upload-token",
  SENTRY_ELECTROBUN_PRODUCTION_DSN: `https://${"c".repeat(32)}@o1.ingest.us.sentry.io/2`,
  SENTRY_ELECTROBUN_STAGING_DSN: dsn,
};

test("an unset tier builds locally and reports nothing", () => {
  expect(desktopSentryReleaseEnvironment(secrets, undefined, "")).toEqual({
    PATH: "/usr/bin",
  });
});

test("a configured tier inlines only that tier's public desktop values", () => {
  expect(desktopSentryReleaseEnvironment(secrets, "staging", commit)).toEqual({
    PATH: "/usr/bin",
    BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT: commit,
    BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: dsn,
    BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: "staging",
  });
  const { BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: productionDsn } =
    desktopSentryReleaseEnvironment(secrets, "production", commit);
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
  );
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
      desktopSentryReleaseEnvironment(env, tier, buildCommit),
    ).toThrow();
  }
});
