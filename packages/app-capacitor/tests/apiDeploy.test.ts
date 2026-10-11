import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const homeKey = "HOME";

async function executable(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, source);
  await chmod(path, 0o755);
}

/**
 * Drives packages/api/scripts/deployApi.sh with stubbed Terraform outputs,
 * Bun, and Wrangler, recording what each step received.
 */
async function deployFixture(
  extraEnv: Readonly<Record<string, string>> = {},
  options: {
    readonly trace?: boolean;
    readonly healthcheckUrl?: string | undefined;
  } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-api-deploy-"));
  const log = resolve(root, "calls.log");
  const bin = resolve(root, "bin");
  const script = resolve(root, "packages/api/scripts/deployApi.sh");
  await mkdir(dirname(script), { recursive: true });
  await cp(resolve(import.meta.dir, "../../api/scripts/deployApi.sh"), script);
  await chmod(script, 0o755);
  await mkdir(resolve(root, "packages/api-cli"), { recursive: true });
  await mkdir(resolve(root, ".secrets"), { recursive: true });
  await executable(
    resolve(root, "terraform/scripts/common.sh"),
    [
      // The real loader suspends tracing while it reads secret files.
      "load_secrets_env() {",
      '  local traced=0; if [[ "$-" == *x* ]]; then traced=1; set +x; fi',
      "  TF_VAR_domain=example.test",
      '  DOCUMENT_SYNC_CURSOR_HMAC_KEY="fixture-cursor-key-with-at-least-32-bytes"',
      `  BLOB_GC_HEALTHCHECK_URL=${options.healthcheckUrl ?? "https://hc.example.test/ping/fixture"}`,
      "  SENTRY_API_STAGING_DSN=https://staging-dsn.example.test/1",
      "  export STRIPE_SECRET_KEY=sk_test_fixture",
      '  if [[ "$traced" -eq 1 ]]; then set -x; fi',
      "  return 0",
      "}",
      "validate_aws_env() { :; }",
      "validate_domain_env() { :; }",
      "validate_stripe_env() { :; }",
      "export_wrangler_env() {",
      '  local traced=0; if [[ "$-" == *x* ]]; then traced=1; set +x; fi',
      "  export CLOUDFLARE_API_TOKEN=fixture-token",
      '  if [[ "$traced" -eq 1 ]]; then set -x; fi',
      "  return 0",
      "}",
      'tier_api_hostname() { echo "api-$1.example.test"; }',
      'tier_app_hostname() { echo "app-$1.example.test"; }',
      'tier_demo_hostname() { echo "demo-$1.example.test"; }',
    ].join("\n"),
  );
  await executable(
    resolve(root, "terraform/scripts/run-postgres-stack.sh"),
    [
      "#!/bin/sh",
      'printf \'{"postgres_host":"fixture.pg.psdb.cloud","postgres_port":"6432","postgres_migration_port":"5432","postgres_db":"fixture-db","postgres_user":"runtime.user","postgres_password":"runtime-password","postgres_migration_user":"migration.user","postgres_migration_password":"migration-password"}\\n\'',
    ].join("\n"),
  );
  await executable(
    resolve(root, "terraform/scripts/run-storage-stack.sh"),
    [
      "#!/bin/sh",
      'printf \'{"blob_s3_access_key_id":"fixture-key","blob_s3_secret_access_key":"fixture-secret","blob_s3_key_prefix":""}\\n\'',
    ].join("\n"),
  );
  await executable(
    resolve(bin, "git"),
    '#!/bin/sh\nprintf "%s\\n" "$API_DEPLOY_TEST_ROOT"\n',
  );
  await executable(
    resolve(bin, "bun"),
    [
      "#!/bin/bash",
      "set -eu",
      'case "$*" in',
      "  'src/index.ts migrate')",
      `    printf 'migrate|%s|%s|%s|%s|%s|%s\\n' "\${POSTGRES_HOST:-}" "\${POSTGRES_PORT:-}" "\${POSTGRES_USER:-}" "\${POSTGRES_DATABASE:-}" "\${DATABASE_URL:-unset}" "\${POSTGRES_URL:-unset}" >> "$API_DEPLOY_TEST_LOG"`,
      "    ;;",
      "  'scripts/workerDefines.ts')",
      '    printf \'API_BUILD_VERSION:123\\nAPI_DIAGNOSTICS_BUILD:{"commit":"abc"}\\n\'',
      "    ;;",
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
  );
  await executable(
    resolve(bin, "bunx"),
    [
      "#!/bin/bash",
      "set -eu",
      "shift # --no-install",
      'case "$*" in',
      "  'wrangler secret bulk '*)",
      '    cp "$4" "$API_DEPLOY_TEST_ROOT/secrets.json"',
      '    printf \'secret-bulk|%s\\n\' "$6" >> "$API_DEPLOY_TEST_LOG"',
      "    ;;",
      "  'wrangler secret list '*)",
      '    printf \'[{"name":"POSTGRES_HOST"},{"name":"OLD_WEBHOOK_SECRET"}]\\n\'',
      "    ;;",
      "  'wrangler secret delete '*)",
      '    printf \'secret-delete|%s|%s\\n\' "$4" "$6" >> "$API_DEPLOY_TEST_LOG"',
      "    ;;",
      "  'wrangler deploy '*)",
      '    printf \'deploy|%s\\n\' "$*" >> "$API_DEPLOY_TEST_LOG"',
      "    ;;",
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
  );
  const { PATH } = process.env;
  const command = options.trace
    ? ["bash", "-x", script, "staging"]
    : [script, "staging"];
  const child = Bun.spawn(command, {
    cwd: root,
    env: {
      PATH: `${bin}:${PATH ?? ""}`,
      HOME: process.env[homeKey] ?? root,
      API_DEPLOY_TEST_ROOT: root,
      API_DEPLOY_TEST_LOG: log,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const calls = (await readFile(log, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean);
  const secrets = JSON.parse(
    await readFile(resolve(root, "secrets.json"), "utf8").catch(() => "null"),
  ) as Record<string, string> | null;
  await rm(root, { recursive: true, force: true });
  return { exitCode, stdout, stderr, calls, secrets };
}

test("migrations use the stack's migration login and ignore inherited connection URLs", async () => {
  const run = await deployFixture({
    DATABASE_URL: "postgres://other/db",
    POSTGRES_URL: "postgres://other/db",
  });
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls[0]).toBe(
    "migrate|fixture.pg.psdb.cloud|5432|migration.user|fixture-db|unset|unset",
  );
});

test("the Worker receives the runtime login, derived origins, and only managed secrets", async () => {
  const run = await deployFixture();
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.secrets).toMatchObject({
    POSTGRES_HOST: "fixture.pg.psdb.cloud",
    POSTGRES_PORT: "6432",
    POSTGRES_USER: "runtime.user",
    POSTGRES_PASSWORD: "runtime-password",
    POSTGRES_DATABASE: "fixture-db",
    DOCUMENT_SYNC_CURSOR_HMAC_KEY: "fixture-cursor-key-with-at-least-32-bytes",
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
  expect(run.calls).toContain("secret-bulk|staging");
  expect(run.calls).toContain("secret-delete|OLD_WEBHOOK_SECRET|staging");
  expect(
    run.calls.filter((call) => call.startsWith("secret-delete")),
  ).toHaveLength(1);
  const deploy = run.calls.find((call) => call.startsWith("deploy|"));
  expect(deploy).toContain("wrangler deploy --env staging");
  expect(deploy).toContain("--define API_BUILD_VERSION:123");
  expect(deploy).toContain(
    "--var API_PUBLIC_ORIGIN:https://api-staging.example.test",
  );
  expect(deploy).toContain(
    "--var API_CORS_ORIGINS:https://app-staging.example.test,https://demo-staging.example.test,https://localhost,http://127.0.0.1:3002",
  );
  // Migrations precede the publish.
  expect(
    run.calls.findIndex((call) => call.startsWith("migrate|")),
  ).toBeLessThan(run.calls.findIndex((call) => call.startsWith("deploy|")));
});

for (const [label, healthcheckUrl] of [
  ["missing", ""],
  ["not https", "http://hc.example.test/ping/fixture"],
]) {
  test(`a ${label} Healthchecks URL stops the deploy before anything runs`, async () => {
    const run = await deployFixture({}, { healthcheckUrl });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      "BLOB_GC_HEALTHCHECK_URL must be an https URL",
    );
    expect(run.calls).toEqual([]);
  });
}

test("a traced run never prints a secret", async () => {
  const run = await deployFixture({}, { trace: true });
  expect(run.exitCode, run.stderr).toBe(0);
  // Tracing is on again for the deploy itself.
  expect(run.stderr).toContain("wrangler deploy --env staging");
  for (const secret of [
    "migration-password",
    "runtime-password",
    "fixture-cursor-key",
    "fixture-secret",
    "fixture-token",
    "staging-dsn.example.test",
  ]) {
    expect(run.stderr).not.toContain(secret);
  }
});
