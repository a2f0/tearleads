import {
  appendFile,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { commitDeploymentFixture } from "./deploymentGit.testUtils";

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
export async function deployFixture(
  extraEnv: Readonly<Record<string, string>> = {},
  options: {
    readonly trace?: boolean;
    readonly dirty?: boolean;
    readonly healthcheckUrl?: string | undefined;
    readonly hyperdriveId?: string;
    readonly tier?: "staging" | "prod";
    readonly storage?: Readonly<Record<string, unknown>>;
    readonly generateCursorKey?: boolean;
  } = {},
) {
  const matrix = await mkdtemp(resolve(tmpdir(), "tearleads-api-deploy-"));
  commitDeploymentFixture(matrix, "matrix");
  const root = resolve(matrix, "checkouts/tearleads");
  const log = resolve(root, "calls.log");
  const bin = resolve(root, "bin");
  const script = resolve(root, "packages/api/scripts/deployApi.sh");
  await mkdir(dirname(script), { recursive: true });
  await cp(resolve(import.meta.dir, "../../api/scripts/deployApi.sh"), script);
  await cp(
    resolve(import.meta.dir, "../../api/scripts/sentryBuild.sh"),
    resolve(dirname(script), "sentryBuild.sh"),
  );
  await chmod(script, 0o755);
  await cp(
    resolve(import.meta.dir, "../../api/wrangler.jsonc"),
    resolve(root, "packages/api/wrangler.jsonc"),
  );
  const billingReader = "packages/api/src/billing/returnOrigins.ts";
  await mkdir(dirname(resolve(root, billingReader)), { recursive: true });
  await cp(
    resolve(import.meta.dir, "../../api/src/billing/returnOrigins.ts"),
    resolve(root, billingReader),
  );
  await mkdir(resolve(root, "packages/api-cli"), { recursive: true });
  await mkdir(resolve(root, ".secrets", options.tier ?? "staging"), {
    recursive: true,
  });
  await executable(
    resolve(root, "terraform/scripts/common.sh"),
    [
      // The real loader suspends tracing while it reads secret files.
      "load_secrets_env() {",
      '  local traced=0; if [[ "$-" == *x* ]]; then traced=1; set +x; fi',
      "  TF_VAR_domain=example.test",
      `  TF_VAR_cloudflare_account_id=${"b".repeat(32)}`,
      // Generated keys are read back from the tier's worker.env.
      options.generateCursorKey
        ? '  if [[ -f "$API_DEPLOY_TEST_ROOT/.secrets/$1/worker.env" ]]; then . "$API_DEPLOY_TEST_ROOT/.secrets/$1/worker.env"; fi'
        : '  DOCUMENT_SYNC_CURSOR_HMAC_KEY="fixture-cursor-key-with-at-least-32-bytes" TWO_FACTOR_SECRET_KEY="fixture-two-factor-key-with-at-least-32-bytes"',
      `  BLOB_GC_HEALTHCHECK_URL=${options.healthcheckUrl ?? "https://hc.example.test/ping/fixture"}`,
      "  SENTRY_API_STAGING_DSN=https://staging-dsn.example.test/1",
      "  SENTRY_API_PRODUCTION_DSN=https://production-dsn.example.test/2",
      "  SENTRY_ORG=fixture-org",
      "  export SENTRY_AUTH_TOKEN=fixture-upload-token",
      "  export STRIPE_SECRET_KEY=sk_test_fixture",
      '  if [[ "$traced" -eq 1 ]]; then set -x; fi',
      "  return 0",
      "}",
      "validate_tf_state_env() { :; }",
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
      `if [ "$4" = "hyperdrive_id" ]; then printf '%s\\n' '${options.hyperdriveId ?? "a".repeat(32)}'; exit 0; fi`,
      'printf \'{"postgres_host":"fixture.pg.psdb.cloud","postgres_port":"6432","postgres_migration_port":"5432","postgres_db":"fixture-db","postgres_user":"runtime.user","postgres_password":"runtime-password","postgres_migration_user":"migration.user","postgres_migration_password":"migration-password"}\\n\'',
    ].join("\n"),
  );
  await Bun.write(
    resolve(root, "storage-output.json"),
    JSON.stringify({
      blob_object_store: "s3",
      blob_s3_bucket: `tearleads-blobs-${options.tier ?? "staging"}`,
      blob_s3_region: "auto",
      blob_s3_endpoint: `https://${"b".repeat(32)}.r2.cloudflarestorage.com`,
      blob_s3_force_path_style: true,
      blob_s3_access_key_id: "fixture-key",
      blob_s3_secret_access_key: "fixture-secret",
      ...options.storage,
    }),
  );
  await executable(
    resolve(root, "terraform/scripts/run-storage-stack.sh"),
    '#!/bin/sh\ncat "$API_DEPLOY_TEST_ROOT/storage-output.json"\n',
  );
  await executable(
    resolve(bin, "bun"),
    [
      "#!/bin/bash",
      "set -eu",
      'case "$*" in',
      `  -e*) exec '${process.execPath}' "$@" ;;`,
      "  'src/index.ts migrate')",
      `    printf 'migrate|%s|%s|%s|%s|%s|%s\\n' "\${POSTGRES_HOST:-}" "\${POSTGRES_PORT:-}" "\${POSTGRES_USER:-}" "\${POSTGRES_DATABASE:-}" "\${DATABASE_URL:-unset}" "\${POSTGRES_URL:-unset}" >> "$API_DEPLOY_TEST_LOG"`,
      "    ;;",
      "  'scripts/workerDefines.ts')",
      "    printenv GIT_REPLACE_REF_BASE >/dev/null && exit 91",
      '    printf \'API_BUILD_VERSION:123\\nAPI_DIAGNOSTICS_BUILD:{"commit":"abc"}\\n\'',
      "    ;;",
      "  'run sentry:cli sourcemaps upload '*)",
      '    printf \'map-upload|%s\\n\' "$*" >> "$API_DEPLOY_TEST_LOG"',
      `    [[ "\${API_DEPLOY_TEST_UPLOAD_FAIL:-}" != 1 ]] || exit 1`,
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
      // `fail` stands for a Worker that cannot be asked; any other value
      // adds its JSON entries to the Worker's secrets.
      `    API_DEPLOY_TEST_WORKER_SECRETS="\${API_DEPLOY_TEST_WORKER_SECRETS:-}"`,
      '    [[ "$API_DEPLOY_TEST_WORKER_SECRETS" != fail ]] || exit 1',
      '    printf \'[{"name":"POSTGRES_HOST"},{"name":"POSTGRES_PORT"},{"name":"POSTGRES_USER"},{"name":"POSTGRES_PASSWORD"},{"name":"POSTGRES_DATABASE"},{"name":"OLD_WEBHOOK_SECRET"}%s]\\n\' "$API_DEPLOY_TEST_WORKER_SECRETS"',
      "    ;;",
      "  'wrangler secret delete '*)",
      '    printf \'secret-delete|%s|%s\\n\' "$4" "$6" >> "$API_DEPLOY_TEST_LOG"',
      "    ;;",
      "  'wrangler deploy '*)",
      '    original="$*"; entry="$3"; output=""; config=""; dry_run=0',
      "    while [[ $# -gt 0 ]]; do",
      '      case "$1" in',
      '        --outdir) output="$2"; shift ;;',
      '        --config) config="$2"; shift ;;',
      "        --dry-run) dry_run=1 ;;",
      "      esac",
      "      shift",
      "    done",
      '    if [[ "$dry_run" == 1 ]]; then',
      '      mkdir -p "$output"',
      '      echo "compiled fixture" > "$output/index.js"',
      '      echo "{}" > "$output/index.js.map"',
      '      printf \'build|%s\\n\' "$original" >> "$API_DEPLOY_TEST_LOG"',
      "    else",
      '      [[ "$entry" == */bundle/index.js && -s "$entry" ]]',
      '      cp "$config" "$API_DEPLOY_TEST_ROOT/deployed-config.jsonc"',
      '      printf \'deploy|%s\\n\' "$original" >> "$API_DEPLOY_TEST_LOG"',
      "    fi",
      "    ;;",
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
  );
  const { PATH } = process.env;
  const head = commitDeploymentFixture(
    root,
    "checkout",
    "packages/api/scripts/deployApi.sh",
  );
  if (options.dirty) await appendFile(script, "\n# fixture change\n");
  const command = options.trace
    ? ["bash", "-x", script, options.tier ?? "staging"]
    : [script, options.tier ?? "staging"];
  const child = Bun.spawn(command, {
    cwd: matrix,
    env: {
      GIT_DIR: resolve(matrix, ".git"),
      GIT_WORK_TREE: matrix,
      GIT_REPLACE_REF_BASE: "refs/matrix/replacements/",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.worktree",
      GIT_CONFIG_VALUE_0: matrix,
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
  const deployedConfig = await readFile(
    resolve(root, "deployed-config.jsonc"),
    "utf8",
  ).catch(() => "");
  const workerEnv = await readFile(
    resolve(root, ".secrets", options.tier ?? "staging", "worker.env"),
    "utf8",
  ).catch(() => null);
  await rm(matrix, { recursive: true, force: true });
  return {
    head,
    exitCode,
    stdout,
    stderr,
    calls,
    secrets,
    deployedConfig,
    workerEnv,
  };
}
