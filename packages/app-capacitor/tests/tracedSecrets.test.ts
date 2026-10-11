import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

// Operators debug deployment scripts with `bash -x`. Every script that moves a
// credential through a shell variable suspends tracing around it, so a traced
// run can be pasted into an issue without leaking the tier's secrets.

const pathKey = "PATH";
const S3_SECRET = "s3-secret-sentinel";
const MIGRATION_PASSWORD = "migration-password-sentinel";

async function tracedRun(scriptPath: string, args: readonly string[]) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-traced-"));
  const log = resolve(root, "calls.log");
  const bin = resolve(root, "bin");
  async function executable(path: string, source: string) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, `${source}\n`);
    await chmod(path, 0o755);
  }
  try {
    const script = resolve(root, scriptPath);
    await mkdir(dirname(script), { recursive: true });
    await cp(resolve(import.meta.dir, "../../..", scriptPath), script);
    await mkdir(resolve(root, "packages/api-cli"), { recursive: true });
    await mkdir(resolve(root, "packages/api-shared"), { recursive: true });
    await executable(
      resolve(bin, "git"),
      '#!/bin/sh\nprintf "%s\\n" "$TRACED_TEST_ROOT"',
    );
    await executable(
      resolve(bin, "bun"),
      '#!/bin/sh\nprintf "bun %s\\n" "$*" >> "$TRACED_TEST_LOG"',
    );
    await executable(
      resolve(root, "terraform/scripts/common.sh"),
      "load_secrets_env() { :; }\nvalidate_aws_env() { :; }",
    );
    await executable(
      resolve(root, "terraform/scripts/run-storage-stack.sh"),
      `#!/bin/sh\nprintf '{"blob_s3_bucket":"fixture","blob_s3_region":"us-east-1","blob_s3_force_path_style":"false","blob_s3_access_key_id":"fixture-key","blob_s3_secret_access_key":"${S3_SECRET}","blob_s3_key_prefix":""}\\n'`,
    );
    await executable(
      resolve(root, "terraform/scripts/run-postgres-stack.sh"),
      `#!/bin/sh\nprintf '{"postgres_host":"fixture.pg.psdb.cloud","postgres_migration_port":"5432","postgres_db":"fixture-db","postgres_migration_user":"migration.user","postgres_migration_password":"${MIGRATION_PASSWORD}"}\\n'`,
    );
    const child = Bun.spawn(["bash", "-x", script, ...args], {
      cwd: root,
      env: {
        PATH: `${bin}:${process.env[pathKey] ?? ""}`,
        TRACED_TEST_ROOT: root,
        TRACED_TEST_LOG: log,
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
    return { exitCode, stdout, stderr, calls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a traced bucket listing never prints the storage secret", async () => {
  const run = await tracedRun("scripts/listBlobBucketKeys.sh", ["staging"]);
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls).toEqual(["bun src/index.ts blob-store:list-keys"]);
  expect(run.stderr).toContain("+ ");
  expect(run.stderr).not.toContain(S3_SECRET);
  expect(run.stdout).not.toContain(S3_SECRET);
});

test("a traced staging drop never prints the migration password", async () => {
  const run = await tracedRun("terraform/scripts/drop-postgres-owned.sh", [
    "staging",
  ]);
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls).toEqual(["bun scripts/dropOwnedObjects.ts"]);
  expect(run.stderr).toContain("+ ");
  expect(run.stderr).not.toContain(MIGRATION_PASSWORD);
  expect(run.stdout).not.toContain(MIGRATION_PASSWORD);
});

test("the real credential validators never print a secret under tracing", async () => {
  const script = resolve(
    import.meta.dir,
    "../../../terraform/scripts/common.sh",
  );
  const child = Bun.spawn(
    [
      "bash",
      "-c",
      `source "$1"; set -x; validate_aws_env; validate_cloudflare_env; export_wrangler_env; set +x; echo validated`,
      "bash",
      script,
    ],
    {
      env: {
        PATH: process.env[pathKey] ?? "",
        AWS_ACCESS_KEY_ID: "aws-key-id-sentinel",
        AWS_SECRET_ACCESS_KEY: "aws-secret-sentinel",
        TF_VAR_cloudflare_api_token: "cloudflare-token-sentinel",
        TF_VAR_cloudflare_account_id: "account",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toContain("validated");
  expect(stderr).toContain("+ validate_aws_env");
  for (const secret of ["aws-secret-sentinel", "cloudflare-token-sentinel"]) {
    expect(stderr).not.toContain(secret);
  }
});
