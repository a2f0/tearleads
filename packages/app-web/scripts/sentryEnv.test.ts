import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./sentryEnv.sh", import.meta.url));
const stagingDsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/11`;
const productionDsn = `https://${"b".repeat(32)}@o1.ingest.us.sentry.io/22`;
function configure(tier: string, env: Record<string, string> = {}) {
  const { PATH } = process.env;
  return Bun.spawnSync(
    [
      "/bin/bash",
      "-euc",
      '. "$1"\nconfigure_sentry_env "$2"\nprintf "%s\\n" "$BUN_PUBLIC_SENTRY_DSN" "$BUN_PUBLIC_SENTRY_ENVIRONMENT" "$SENTRY_PROJECT"',
      "test",
      script,
      tier,
    ],
    {
      env: { PATH, ...env },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

test("deployment selects separate projects and ignores inherited public settings", () => {
  const env = {
    SENTRY_STAGING_DSN: stagingDsn,
    SENTRY_PRODUCTION_DSN: productionDsn,
    SENTRY_STAGING_PROJECT: "tearleads-staging",
    SENTRY_PRODUCTION_PROJECT: "tearleads-production",
    SENTRY_ORG: "example",
    SENTRY_AUTH_TOKEN: "private-upload-token",
    BUN_PUBLIC_SENTRY_DSN: "wrong-inherited-dsn",
    SENTRY_PROJECT: "wrong-project",
  };
  for (const [tier, dsn, environment, project] of [
    ["staging", stagingDsn, "staging", "tearleads-staging"],
    ["prod", productionDsn, "production", "tearleads-production"],
  ]) {
    const result = configure(tier ?? "", env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(
      `${dsn}\n${environment}\n${project}\n`,
    );
    expect(result.stdout.toString() + result.stderr.toString()).not.toContain(
      env.SENTRY_AUTH_TOKEN,
    );
  }
});

test("unconfigured deployments remain disabled and partial configuration fails before publication", () => {
  const disabled = configure("staging", {
    BUN_PUBLIC_SENTRY_DSN: productionDsn,
  });
  expect(disabled.exitCode).toBe(0);
  expect(disabled.stdout.toString()).toBe("\nstaging\n\n");
  expect(
    configure("prod", { SENTRY_PRODUCTION_DSN: productionDsn }).exitCode,
  ).not.toBe(0);
  expect(configure("other").exitCode).not.toBe(0);
  expect(
    configure("prod", {
      SENTRY_PRODUCTION_DSN: "https://private@evil.example/22",
    }).exitCode,
  ).not.toBe(0);
});
