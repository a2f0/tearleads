import { expect, test } from "bun:test";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const sourceScript = resolve(
  import.meta.dir,
  "../../../scripts/deployEverything.sh",
);
const commonScript = resolve(
  import.meta.dir,
  "../../../terraform/scripts/common.sh",
);

const commandPaths = [
  "scripts/uploadIosStagingRelease.sh",
  "scripts/uploadIosRelease.sh",
  "scripts/uploadAndroidStagingRelease.sh",
  "scripts/uploadAndroidRelease.sh",
  "scripts/deployStaging.sh",
  "packages/code-assist/scripts/deployStagingCodeAssist.sh",
  "scripts/deployProduction.sh",
  "packages/code-assist/scripts/deployProductionCodeAssist.sh",
] as const;

interface HarnessRun {
  readonly exitCode: number;
  readonly stderr: string;
  readonly calls: readonly string[];
  readonly root: string;
}

function environmentValue(name: string): string | undefined {
  return process.env[name];
}

async function writeExecutable(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, source);
  await chmod(path, 0o755);
}

async function runHarness(
  options: {
    readonly environment?: Readonly<Record<string, string>>;
    readonly failAt?: string;
    readonly secretStagingTarget?: string;
    readonly secretProductionTarget?: string;
  } = {},
): Promise<HarnessRun> {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-deploy-everything-"));
  const script = resolve(root, "scripts/deployEverything.sh");
  const logPath = resolve(root, "calls.log");
  const binDirectory = resolve(root, "bin");

  await mkdir(dirname(script), { recursive: true });
  await cp(sourceScript, script);
  await chmod(script, 0o755);
  await writeExecutable(
    resolve(root, "terraform/scripts/common.sh"),
    [
      "#!/usr/bin/env bash",
      "load_secrets_env() {",
      '  case "$1" in',
      `    staging) SSH_TARGET="\${STUB_STAGING_SECRET_TARGET:-}" ;;`,
      `    prod) SSH_TARGET="\${STUB_PRODUCTION_SECRET_TARGET:-}" ;;`,
      "  esac",
      "  export SSH_TARGET",
      "}",
      "validate_aws_env() { :; }",
      "get_backend_config() { printf '/dev/null\\n'; }",
      "resolve_stack_ssh_target() {",
      '  case "$1" in',
      "    */staging/*) printf 'staging-user@staging-host\\n' ;;",
      "    */prod/*) printf 'prod-user@prod-host\\n' ;;",
      "  esac",
      "}",
    ].join("\n"),
  );
  await writeExecutable(
    resolve(binDirectory, "terraform"),
    "#!/bin/sh\nexit 0\n",
  );

  const commandStub = [
    "#!/bin/sh",
    'name="$(basename "$0")"',
    `printf '%s|%s|%s\\n' "$name" "\${SSH_TARGET:-}" "$PWD" >> "$DEPLOY_EVERYTHING_TEST_LOG"`,
    `if [ "$name" = "\${DEPLOY_EVERYTHING_FAIL_AT:-}" ]; then exit 23; fi`,
  ].join("\n");
  for (const path of commandPaths) {
    await writeExecutable(resolve(root, path), commandStub);
  }

  try {
    const child = Bun.spawn([script], {
      cwd: tmpdir(),
      env: {
        ...process.env,
        PATH: `${binDirectory}:${environmentValue("PATH") ?? ""}`,
        SSH_TARGET: "",
        STAGING_SSH_TARGET: "",
        PRODUCTION_SSH_TARGET: "",
        STUB_STAGING_SECRET_TARGET: options.secretStagingTarget ?? "",
        STUB_PRODUCTION_SECRET_TARGET: options.secretProductionTarget ?? "",
        DEPLOY_EVERYTHING_TEST_LOG: logPath,
        DEPLOY_EVERYTHING_FAIL_AT: options.failAt ?? "",
        ...options.environment,
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    const calls = (await readFile(logPath, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean);
    return { exitCode, stderr, calls, root: await realpath(root) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("runs every release in promotion order from the repository root", async () => {
  const run = await runHarness();
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls.map((call) => call.split("|").slice(0, 2))).toEqual([
    ["uploadIosStagingRelease.sh", ""],
    ["uploadIosRelease.sh", ""],
    ["uploadAndroidStagingRelease.sh", ""],
    ["uploadAndroidRelease.sh", ""],
    ["deployStaging.sh", "staging-user@staging-host"],
    ["deployStagingCodeAssist.sh", "staging-user@staging-host"],
    ["deployProduction.sh", "prod-user@prod-host"],
    ["deployProductionCodeAssist.sh", "prod-user@prod-host"],
  ]);
  const workingDirectories = new Set(
    run.calls.map((call) => call.split("|").slice(2).join("|")),
  );
  expect(workingDirectories).toEqual(new Set([run.root]));
});

test("stops at the first failing release command", async () => {
  const run = await runHarness({ failAt: "uploadAndroidStagingRelease.sh" });
  expect(run.exitCode).toBe(23);
  expect(run.calls.map((call) => call.split("|")[0])).toEqual([
    "uploadIosStagingRelease.sh",
    "uploadIosRelease.sh",
    "uploadAndroidStagingRelease.sh",
  ]);
});

test("keeps distinct tier overrides isolated", async () => {
  const run = await runHarness({
    environment: {
      STAGING_SSH_TARGET: "staging-user@explicit-staging",
      PRODUCTION_SSH_TARGET: "prod-user@explicit-production",
    },
    secretStagingTarget: "wrong-secret-target",
    secretProductionTarget: "wrong-secret-target",
  });
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls.slice(4).map((call) => call.split("|")[1])).toEqual([
    "staging-user@explicit-staging",
    "staging-user@explicit-staging",
    "prod-user@explicit-production",
    "prod-user@explicit-production",
  ]);
});

test("rejects duplicate explicit targets before releasing", async () => {
  const run = await runHarness({
    environment: {
      STAGING_SSH_TARGET: "user@same-host",
      PRODUCTION_SSH_TARGET: "user@same-host",
    },
  });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("resolve to the same SSH target");
  expect(run.calls).toEqual([]);
});

test("rejects a single override matching the other resolved tier", async () => {
  const run = await runHarness({
    environment: { STAGING_SSH_TARGET: "prod-user@prod-host" },
  });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("prod-user@prod-host");
  expect(run.calls).toEqual([]);
});

test("secret loading preserves an inherited deployment target", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-common-env-"));
  await mkdir(resolve(root, ".secrets"), { recursive: true });
  await Bun.write(
    resolve(root, ".secrets/root.env"),
    "SSH_TARGET=root-target\n",
  );
  await Bun.write(
    resolve(root, ".secrets/staging.env"),
    "SSH_TARGET=staging-target\n",
  );
  try {
    const child = Bun.spawn(
      [
        "bash",
        "-c",
        [
          'source "$1"',
          "get_repo_root() { printf '%s\\n' \"$COMMON_TEST_ROOT\"; }",
          "export SSH_TARGET=explicit-target",
          "load_secrets_env staging",
          "printf '%s\\n' \"$SSH_TARGET\"",
        ].join("\n"),
        "bash",
        commonScript,
      ],
      {
        env: { ...process.env, COMMON_TEST_ROOT: root },
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
    expect(stdout.trim()).toBe("explicit-target");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
