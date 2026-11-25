import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { deployFixture } from "./apiDeploy.testUtils";
import { commitDeploymentFixture } from "./deploymentGit.testUtils";

test("migrations use the stack's migration login and ignore inherited connection URLs", async () => {
  const run = await deployFixture({
    DATABASE_URL: "postgres://other/db",
    POSTGRES_URL: "postgres://other/db",
  });
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls.find((call) => call.startsWith("migrate|"))).toBe(
    "migrate|fixture.pg.psdb.cloud|5432|migration.user|fixture-db|unset|unset",
  );
});

test("the Worker receives Hyperdrive, derived origins, and only managed secrets", async () => {
  const run = await deployFixture();
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls.find((call) => call.startsWith("map-upload|"))).toContain(
    `--release tearleads-api@${run.head}`,
  );
  expect(run.secrets).toMatchObject({
    DOCUMENT_SYNC_CURSOR_HMAC_KEY: "fixture-cursor-key-with-at-least-32-bytes",
    TWO_FACTOR_SECRET_KEY: "fixture-two-factor-key-with-at-least-32-bytes",
    BLOB_GC_HEALTHCHECK_URL: "https://hc.example.test/ping/fixture",
    BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "fixture-key",
    API_SENTRY_DSN: "https://staging-dsn.example.test/1",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    // Not opted in, so the flag is written as false rather than omitted.
    REVENUECAT_ALLOW_SANDBOX_EVENTS: "false",
  });
  expect(run.secrets).not.toHaveProperty("STRIPE_WEBHOOK_SECRET");
  expect(run.secrets).not.toHaveProperty("BLOB_OBJECT_STORE_S3_KEY_PREFIX");
  expect(run.secrets).not.toHaveProperty("postgres_migration_password");
  for (const name of [
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DATABASE",
  ]) {
    expect(run.secrets).not.toHaveProperty(name);
    expect(run.calls).toContain(`secret-delete|${name}|staging`);
  }
  expect(run.deployedConfig).toContain(`"id": "${"a".repeat(32)}"`);
  expect(run.deployedConfig).not.toContain("HYPERDRIVE_ID_staging");
  expect(run.calls).toContain("secret-bulk|staging");
  expect(run.calls).toContain("secret-delete|OLD_WEBHOOK_SECRET|staging");
  expect(
    run.calls.filter((call) => call.startsWith("secret-delete")),
  ).toHaveLength(6);
  const deploy = run.calls.find((call) => call.startsWith("deploy|"));
  expect(deploy).toContain("/bundle/index.js --no-bundle --env staging");
  expect(deploy).not.toContain("--define");
  const build = run.calls.find((call) => call.startsWith("build|"));
  expect(build).toContain("--define API_BUILD_VERSION:123");
  expect(build).toContain("--dry-run");
  expect(deploy).toContain(
    "--var BLOB_OBJECT_STORE_S3_BUCKET:tearleads-blobs-staging",
  );
  expect(deploy).toContain("--var BLOB_OBJECT_STORE_S3_REGION:auto");
  expect(deploy).toContain(
    "--var BLOB_OBJECT_STORE_S3_ENDPOINT:https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.r2.cloudflarestorage.com",
  );
  expect(deploy).toContain(
    "--var API_PUBLIC_ORIGIN:https://api-staging.example.test",
  );
  expect(deploy).toContain(
    "--var API_BILLING_RETURN_ORIGINS:https://app-staging.example.test,https://demo-staging.example.test,https://localhost,http://127.0.0.1:3002",
  );
  expect(deploy).toContain("--var API_CORS_ORIGINS:*");
  // Build and map upload precede mutations; publication follows migrations.
  const steps = run.calls.map((call) => call.split("|")[0]);
  expect(steps.slice(0, 5)).toEqual([
    "build",
    "map-upload",
    "migrate",
    "secret-bulk",
    "deploy",
  ]);
  expect(
    run.calls.findIndex((call) => call.startsWith("migrate|")),
  ).toBeLessThan(run.calls.findIndex((call) => call.startsWith("deploy|")));
  expect(
    run.calls.findIndex((call) => call.startsWith("deploy|")),
  ).toBeLessThan(
    run.calls.findIndex((call) => call.startsWith("secret-delete|")),
  );
});

for (const [label, healthcheckUrl] of [
  ["missing", ""],
  ["not https", "http://hc.example.test/ping/fixture"],
]) {
  test(`a ${label} Healthchecks URL stops the deploy before anything runs`, async () => {
    const run = await deployFixture({}, { healthcheckUrl });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      "BLOB_GC_HEALTHCHECK_URL must be an https URL; set it in .secrets/staging/healthchecks.env",
    );
    expect(run.calls).toEqual([]);
  });
}

for (const tier of ["staging", "prod"] as const) {
  test(`missing ${tier} cursor and two-factor keys are generated once into the tier's worker.env`, async () => {
    const run = await deployFixture({}, { tier, generateCursorKey: true });
    expect(run.exitCode, run.stderr).toBe(0);
    const pattern =
      /^export DOCUMENT_SYNC_CURSOR_HMAC_KEY=(\w{64})\nexport TWO_FACTOR_SECRET_KEY=(\w{64})\n$/;
    const [, cursor, twoFactor] = run.workerEnv?.match(pattern) ?? [];
    expect(twoFactor).not.toBe(cursor);
    expect(run.secrets).toHaveProperty("DOCUMENT_SYNC_CURSOR_HMAC_KEY", cursor);
    expect(run.secrets).toHaveProperty("TWO_FACTOR_SECRET_KEY", twoFactor);
  });
}

test("a traced run never prints a secret", async () => {
  const run = await deployFixture({}, { trace: true });
  expect(run.exitCode, run.stderr).toBe(0);
  // Tracing is on again for the deploy itself.
  expect(run.stderr).toContain("/bundle/index.js --no-bundle --env staging");
  for (const secret of [
    "migration-password",
    "runtime-password",
    "fixture-cursor-key",
    "fixture-secret",
    "fixture-token",
    "fixture-upload-token",
    "staging-dsn.example.test",
  ]) {
    expect(run.stderr).not.toContain(secret);
  }
});

test("a map upload failure stops before migrations, secrets, and publication", async () => {
  const run = await deployFixture({ API_DEPLOY_TEST_UPLOAD_FAIL: "1" });
  expect(run.exitCode).not.toBe(0);
  expect(run.calls.map((call) => call.split("|")[0])).toEqual([
    "build",
    "map-upload",
  ]);
  expect(run.secrets).toBeNull();
  expect(run.deployedConfig).toBe("");
});

test("billing overrides stay separate from wildcard CORS", async () => {
  const run = await deployFixture({
    API_CORS_ORIGINS: "https://old-cors.example.test",
    API_BILLING_RETURN_ORIGINS:
      "https://app.example.test,https://partner.example.test",
  });
  expect(run.exitCode, run.stderr).toBe(0);
  const deploy = run.calls.find((call) => call.startsWith("deploy|"));
  expect(deploy).toContain(
    "--var API_BILLING_RETURN_ORIGINS:https://app.example.test,https://partner.example.test",
  );
  expect(deploy).not.toContain("demo-staging.example.test");
  expect(deploy).not.toContain("old-cors.example.test");
  expect(deploy).toContain("--var API_CORS_ORIGINS:*");
  expect(deploy).toContain(
    "--var API_PUBLIC_ORIGIN:https://api-staging.example.test",
  );
});

for (const origins of [
  "*",
  "https://app.example,*",
  "https://app.example/billing",
]) {
  test(`invalid billing origins stop deployment before mutations: ${origins}`, async () => {
    const run = await deployFixture({ API_BILLING_RETURN_ORIGINS: origins });
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain(
      "API_BILLING_RETURN_ORIGINS must contain http(s) origins",
    );
    expect(run.calls).toEqual([]);
    expect(run.secrets).toBeNull();
  });
}

test("production binds the production stack ID", async () => {
  const id = "b".repeat(32);
  const run = await deployFixture({}, { tier: "prod", hyperdriveId: id });
  expect(run.exitCode, run.stderr).toBe(0);
  expect(Bun.JSON5.parse(run.deployedConfig)).toMatchObject({
    env: {
      prod: { hyperdrive: [{ binding: "HYPERDRIVE", id }] },
      staging: { hyperdrive: [{ id: "HYPERDRIVE_ID_staging" }] },
      local: { vars: { API_WORKER_LOCAL: "true" } },
    },
  });
});

test("a missing Hyperdrive ID stops before migration or secret changes", async () => {
  const run = await deployFixture({}, { hyperdriveId: "" });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("hyperdrive_id must be a configuration ID");
  expect(run.calls).toEqual([]);
});

for (const [label, storage] of [
  [
    "AWS storage",
    { blob_s3_bucket: "tearleads-staging", blob_s3_region: "us-east-1" },
  ],
  ["missing endpoint", { blob_s3_endpoint: undefined }],
  [
    "another account",
    { blob_s3_endpoint: `https://${"c".repeat(32)}.r2.cloudflarestorage.com` },
  ],
] as const) {
  test(`R2 storage guard rejects ${label} before migrations or Worker changes`, async () => {
    const run = await deployFixture({}, { storage });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("Apply the staging R2 storage stack");
    expect(run.calls).toEqual([]);
    expect(run.secrets).toBeNull();
    expect(run.deployedConfig).toBe("");
  });
}

test("a dirty API checkout stops before Sentry upload or publication", async () => {
  const run = await deployFixture({}, { dirty: true });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("requires a clean checkout");
  expect(run.calls).toEqual([]);
});

test("API deployment requires the exported tree's own Git metadata", async () => {
  const outer = await mkdtemp(resolve(tmpdir(), "tearleads-api-parent-"));
  try {
    const path = "checkouts/export/packages/api/scripts/deployApi.sh";
    await mkdir(dirname(resolve(outer, path)), { recursive: true });
    await cp(
      resolve(import.meta.dir, "../../api/scripts/deployApi.sh"),
      resolve(outer, path),
    );
    const env = {
      PATH: "/usr/bin:/bin",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    commitDeploymentFixture(outer, "outer");
    const result = Bun.spawnSync(["bash", path, "prod"], { cwd: outer, env });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "API deployment requires its own Git checkout",
    );
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});
