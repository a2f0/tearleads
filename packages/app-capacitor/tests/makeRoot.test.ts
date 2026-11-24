import { expect, test } from "bun:test";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

// scripts/admin/makeRoot.sh grants root through the API CLI. Against a
// deployed tier it must reach that tier's database with the migration login
// over verified TLS, whatever connection the operator's shell inherited.

const pathKey = "PATH";
const FINGERPRINT = "a".repeat(64);
const SCRIPT = "scripts/admin/makeRoot.sh";
// The fake CLI logs one field per connection input, "unset" when absent.
const LOGGED_ENV = [
  "NODE_ENV",
  "API_DATABASE",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DATABASE",
  "POSTGRES_SSL",
  "POSTGRES_SSL_REJECT_UNAUTHORIZED",
  "DATABASE_URL",
  "POSTGRES_URL",
  "PGHOST",
] as const;

async function executable(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${source}\n`);
  await chmod(path, 0o755);
}

async function runMakeRoot(
  args: readonly string[],
  env: Record<string, string> = {},
) {
  const root = await realpath(
    await mkdtemp(resolve(tmpdir(), "tearleads-make-root-")),
  );
  const log = resolve(root, "calls.log");
  const scratch = resolve(root, "tmp");
  try {
    const script = resolve(root, SCRIPT);
    await mkdir(dirname(script), { recursive: true });
    await cp(resolve(import.meta.dir, "../../..", SCRIPT), script);
    await mkdir(resolve(root, "packages/api-cli"), { recursive: true });
    await mkdir(scratch);
    await executable(
      resolve(root, "bin/bun"),
      [
        "#!/bin/sh",
        `printf '%s\\n' "bun|$(pwd -P)|$*${LOGGED_ENV.map((name) => `|\${${name}:-unset}`).join("")}" >> "$MAKE_ROOT_TEST_LOG"`,
        `exit "\${MAKE_ROOT_TEST_BUN_EXIT:-0}"`,
      ].join("\n"),
    );
    await executable(
      resolve(root, "terraform/scripts/run-postgres-stack.sh"),
      [
        "#!/bin/sh",
        'printf \'terraform|%s\\n\' "$*" >> "$MAKE_ROOT_TEST_LOG"',
        'printf \'{"postgres_host":"fixture.pg.psdb.cloud","postgres_migration_port":"5432","postgres_db":"fixture-db","postgres_migration_user":"migration.user","postgres_migration_password":"migration-password"}\\n\'',
      ].join("\n"),
    );
    const child = Bun.spawn(["bash", script, ...args], {
      cwd: root,
      env: {
        PATH: `${resolve(root, "bin")}:${process.env[pathKey] ?? ""}`,
        TMPDIR: scratch,
        MAKE_ROOT_TEST_LOG: log,
        ...env,
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
    return {
      apiCliDir: resolve(root, "packages/api-cli"),
      calls,
      exitCode,
      leftovers: await readdir(scratch),
      stderr,
      stdout,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const inheritedConnection = {
  DATABASE_URL: "postgres://inherited/db",
  POSTGRES_URL: "postgres://inherited/db",
  PGHOST: "inherited-host",
  POSTGRES_PASSWORD: "inherited-password",
};

test.each(["staging", "prod"])(
  "%s grants with the migration login over verified TLS, ignoring inherited connections",
  async (tier) => {
    const run = await runMakeRoot([tier, FINGERPRINT], inheritedConnection);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.calls).toEqual([
      `terraform|${tier} output -json api_connection`,
      [
        "bun",
        run.apiCliDir,
        `src/index.ts make-admin ${FINGERPRINT}`,
        "production",
        "postgres",
        "fixture.pg.psdb.cloud",
        "5432",
        "migration.user",
        "migration-password",
        "fixture-db",
        "true",
        "true",
        "unset",
        "unset",
        "unset",
      ].join("|"),
    ]);
    expect(run.leftovers).toEqual([]);
  },
);

test("a failed grant exits non-zero and still removes the connection file", async () => {
  const run = await runMakeRoot(["prod", FINGERPRINT], {
    MAKE_ROOT_TEST_BUN_EXIT: "1",
  });
  expect(run.exitCode).toBe(1);
  expect(run.calls).toHaveLength(2);
  expect(run.leftovers).toEqual([]);
});

test("dev grants with the inherited connection and never reads Terraform", async () => {
  const run = await runMakeRoot(["dev", FINGERPRINT], {
    DATABASE_URL: "postgres://local/db",
  });
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls).toEqual([
    [
      "bun",
      run.apiCliDir,
      `src/index.ts make-admin ${FINGERPRINT}`,
      ...Array<string>(9).fill("unset"),
      "postgres://local/db",
      "unset",
      "unset",
    ].join("|"),
  ]);
});

test.each([
  ["no arguments", []],
  ["a missing fingerprint", ["prod"]],
  ["an unknown tier", ["local", FINGERPRINT]],
  ["an extra argument", ["prod", FINGERPRINT, "extra"]],
  ["a malformed fingerprint", ["prod", FINGERPRINT.toUpperCase()]],
])("%s fails before reading any connection", async (_name, args) => {
  const run = await runMakeRoot(args);
  expect(run.exitCode).toBe(1);
  expect(run.calls).toEqual([]);
  expect(run.stderr.length).toBeGreaterThan(0);
});

test("--help prints usage and succeeds", async () => {
  const run = await runMakeRoot(["--help"]);
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain("Usage: scripts/admin/makeRoot.sh");
  expect(run.calls).toEqual([]);
});
