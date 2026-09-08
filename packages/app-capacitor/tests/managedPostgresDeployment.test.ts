import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

async function runAnsibleWrapper(
  tier: string,
  missingDatabase = false,
  extraArgs: readonly string[] = [],
) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-managed-postgres-"));
  const bin = resolve(root, "bin");
  const capture = resolve(root, "ansible.json");
  const calls = resolve(root, "database-calls");
  async function executable(path: string, source: string) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, source);
    await chmod(path, 0o755);
  }
  try {
    await mkdir(bin);
    const script = resolve(root, "ansible/scripts/run-server.sh");
    await mkdir(dirname(script), { recursive: true });
    await cp(
      resolve(import.meta.dir, "../../../ansible/scripts/run-server.sh"),
      script,
    );
    await executable(
      resolve(bin, "git"),
      '#!/bin/sh\nprintf "%s\\n" "$POSTGRES_TEST_ROOT"\n',
    );
    await executable(
      resolve(root, "terraform/scripts/common.sh"),
      [
        'load_secrets_env() { SSH_TARGET="deploy@fixture-host"; }',
        "validate_aws_env() { :; }",
        "validate_stripe_env() { :; }",
        'get_backend_config() { echo "backend.hcl"; }',
      ].join("\n"),
    );
    await executable(
      resolve(bin, "terraform"),
      '#!/bin/sh\nif [ "$2" = output ]; then echo fixture-tunnel; fi\n',
    );
    await executable(
      resolve(root, "terraform/scripts/run-postgres-stack.sh"),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$@" > "$POSTGRES_TEST_CALLS"',
        'if [ "$POSTGRES_TEST_MISSING" = true ]; then exit 9; fi',
        'printf \'%s\\n\' \'{"postgres_managed":true,"postgres_host":"fixture.pg.psdb.cloud","postgres_password":"fixture-password","postgres_ssl":true}\'',
      ].join("\n"),
    );
    await executable(
      resolve(bin, "ansible-playbook"),
      [
        `#!${process.execPath}`,
        'import { statSync } from "node:fs";',
        'const path = process.argv.find((arg) => arg.startsWith("@"))?.slice(1);',
        "await Bun.write(process.env.POSTGRES_TEST_CAPTURE, JSON.stringify({",
        "  args: process.argv.slice(2),",
        "  path: path ?? null,",
        "  mode: path ? statSync(path).mode & 0o777 : null,",
        "  connection: path ? await Bun.file(path).json() : null,",
        "}));",
      ].join("\n"),
    );
    const child = Bun.spawn(["bash", script, tier, ...extraArgs], {
      cwd: tmpdir(),
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        POSTGRES_TEST_ROOT: root,
        POSTGRES_TEST_CALLS: calls,
        POSTGRES_TEST_CAPTURE: capture,
        POSTGRES_TEST_MISSING: String(missingDatabase),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const captured = (await Bun.file(capture).exists())
      ? await Bun.file(capture).json()
      : null;
    return {
      exitCode,
      stdout,
      stderr,
      captured,
      connectionFileRemains: captured?.path
        ? await Bun.file(captured.path).exists()
        : false,
      calls: (await Bun.file(calls).exists())
        ? (await Bun.file(calls).text()).trim().split("\n")
        : [],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("production passes persistent credentials in a private temporary file", async () => {
  const result = await runAnsibleWrapper("prod", false, [
    "-e",
    "postgres_host=127.0.0.1",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual(["output", "-json", "api_connection"]);
  expect(result.captured.mode).toBe(0o600);
  expect(result.captured.args.slice(-2)).toEqual([
    "-e",
    `@${result.captured.path}`,
  ]);
  expect(result.captured.connection).toMatchObject({
    postgres_managed: true,
    postgres_host: "fixture.pg.psdb.cloud",
    postgres_ssl: true,
  });
  expect(result.connectionFileRemains).toBe(false);
  expect(result.stdout + result.stderr).not.toContain("fixture-password");
});

test("production refuses to run Ansible without the database output", async () => {
  const result = await runAnsibleWrapper("prod", true);
  expect(result.exitCode).toBe(9);
  expect(result.captured).toBeNull();
});

test("staging configures its local database without consulting PlanetScale", async () => {
  const result = await runAnsibleWrapper("staging", true);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual([]);
  expect(result.captured.connection).toBeNull();
});
