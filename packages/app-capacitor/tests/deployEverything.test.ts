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
  "terraform/stacks/staging/server/scripts/apply.sh",
  "terraform/stacks/prod/server/scripts/apply.sh",
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
    readonly failReadyTarget?: string;
    readonly preExistingProduction?: boolean;
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
      `    staging) SSH_TARGET="\${STUB_STAGING_SECRET_TARGET:-}"; CODE_ASSIST_ENABLED="\${STUB_STAGING_CODE_ASSIST_ENABLED:-false}" ;;`,
      `    prod) SSH_TARGET="\${STUB_PRODUCTION_SECRET_TARGET:-}"; CODE_ASSIST_ENABLED="\${STUB_PRODUCTION_CODE_ASSIST_ENABLED:-false}" ;;`,
      "  esac",
      "  export SSH_TARGET CODE_ASSIST_ENABLED",
      "}",
      "validate_aws_env() { :; }",
      `wait_for_ssh_ready() { [ "$1" != "\${STUB_FAIL_READY_TARGET:-}" ]; }`,
      "get_backend_config() { printf '/dev/null\\n'; }",
      "read_stack_ssh_target() {",
      '  case "$1" in',
      "    */staging/*) [ -f \"$DEPLOY_EVERYTHING_TEST_ROOT/staging.applied\" ] || return 2; printf 'staging-user@staging-host\\n' ;;",
      "    */prod/*) [ -f \"$DEPLOY_EVERYTHING_TEST_ROOT/production.applied\" ] || return 2; printf 'prod-user@prod-host\\n' ;;",
      "  esac",
      "}",
      "resolve_stack_ssh_target() {",
      '  read_stack_ssh_target "$1"',
      "}",
    ].join("\n"),
  );
  await writeExecutable(
    resolve(binDirectory, "terraform"),
    "#!/bin/sh\nexit 0\n",
  );
  await writeExecutable(
    resolve(binDirectory, "ssh"),
    [
      "#!/bin/sh",
      'if [ "$1" = "-G" ]; then',
      '  target="$2"',
      `  host="\${target##*@}"`,
      `  printf 'hostname %s\\n' "$host"`,
      "  exit 0",
      "fi",
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      "    -o) shift 2 ;;",
      '    "cat /etc/machine-id") shift ;;',
      '    *) target="$1"; shift ;;',
      "  esac",
      "done",
      'case "$target" in',
      `  *staging*) printf '%s\\n' "$STUB_STAGING_MACHINE_ID" ;;`,
      `  *) printf '%s\\n' "$STUB_PRODUCTION_MACHINE_ID" ;;`,
      "esac",
    ].join("\n"),
  );
  await writeExecutable(
    resolve(binDirectory, "bun"),
    [
      "#!/bin/sh",
      'case "$DEPLOY_EVERYTHING_RESOLVE_HOST" in',
      "  staging-dns-alias|production-dns-alias) printf '100.64.0.9\\n' ;;",
      `  *) printf '%s\\n' "$DEPLOY_EVERYTHING_RESOLVE_HOST" ;;`,
      "esac",
    ].join("\n"),
  );

  const commandStub = [
    "#!/bin/sh",
    'name="$(basename "$0")"',
    'case "$0" in',
    '  */terraform/stacks/staging/*) name="terraform-staging" ;;',
    '  */terraform/stacks/prod/*) name="terraform-production" ;;',
    "esac",
    'case "$name" in',
    '  terraform-staging) touch "$DEPLOY_EVERYTHING_TEST_ROOT/staging.applied" ;;',
    '  terraform-production) touch "$DEPLOY_EVERYTHING_TEST_ROOT/production.applied" ;;',
    `  deployStaging.sh|deployProduction.sh) [ "\${1:-}" = "--skip-terraform" ] || exit 24 ;;`,
    "esac",
    'case "$name" in',
    `  deployStaging.sh|deployStagingCodeAssist.sh) target="\${STAGING_SSH_TARGET:-}" ;;`,
    `  deployProduction.sh|deployProductionCodeAssist.sh) target="\${PRODUCTION_SSH_TARGET:-}" ;;`,
    `  *) target="\${SSH_TARGET:-}" ;;`,
    "esac",
    `printf '%s|%s|%s\\n' "$name" "$target" "$PWD" >> "$DEPLOY_EVERYTHING_TEST_LOG"`,
    `if [ "$name" = "\${DEPLOY_EVERYTHING_FAIL_AT:-}" ]; then exit 23; fi`,
  ].join("\n");
  for (const path of commandPaths) {
    await writeExecutable(resolve(root, path), commandStub);
  }
  if (options.preExistingProduction) {
    await Bun.write(resolve(root, "production.applied"), "");
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
        DEPLOY_EVERYTHING_TEST_ROOT: root,
        DEPLOY_EVERYTHING_FAIL_AT: options.failAt ?? "",
        STUB_FAIL_READY_TARGET: options.failReadyTarget ?? "",
        STUB_STAGING_MACHINE_ID: "11111111111111111111111111111111",
        STUB_PRODUCTION_MACHINE_ID: "22222222222222222222222222222222",
        STUB_STAGING_CODE_ASSIST_ENABLED: "true",
        STUB_PRODUCTION_CODE_ASSIST_ENABLED: "true",
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
    ["terraform-staging", ""],
    ["deployStaging.sh", "staging-user@staging-host"],
    ["deployStagingCodeAssist.sh", "staging-user@staging-host"],
    ["uploadIosStagingRelease.sh", ""],
    ["uploadAndroidStagingRelease.sh", ""],
    ["terraform-production", ""],
    ["deployProduction.sh", "prod-user@prod-host"],
    ["deployProductionCodeAssist.sh", "prod-user@prod-host"],
    ["uploadIosRelease.sh", ""],
    ["uploadAndroidRelease.sh", ""],
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
    "terraform-staging",
    "deployStaging.sh",
    "deployStagingCodeAssist.sh",
    "uploadIosStagingRelease.sh",
    "uploadAndroidStagingRelease.sh",
  ]);
});

test("skips Code Assist for tiers where it is disabled", async () => {
  const run = await runHarness({
    environment: {
      STUB_STAGING_CODE_ASSIST_ENABLED: "false",
      STUB_PRODUCTION_CODE_ASSIST_ENABLED: "false",
    },
  });
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.calls.map((call) => call.split("|")[0])).toEqual([
    "terraform-staging",
    "deployStaging.sh",
    "uploadIosStagingRelease.sh",
    "uploadAndroidStagingRelease.sh",
    "terraform-production",
    "deployProduction.sh",
    "uploadIosRelease.sh",
    "uploadAndroidRelease.sh",
  ]);
});

test("stops before native releases when SSH readiness fails", async () => {
  const run = await runHarness({
    environment: {
      STAGING_SSH_TARGET: "staging-user@unready-staging",
      PRODUCTION_SSH_TARGET: "prod-user@prod-host",
    },
    failReadyTarget: "staging-user@unready-staging",
  });
  expect(run.exitCode).toBe(1);
  expect(run.calls.map((call) => call.split("|")[0])).toEqual([
    "terraform-staging",
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
  expect(run.calls.map((call) => call.split("|")[1]).filter(Boolean)).toEqual([
    "staging-user@explicit-staging",
    "staging-user@explicit-staging",
    "prod-user@explicit-production",
    "prod-user@explicit-production",
  ]);
});

test("rejects explicit targets on the same host before applying", async () => {
  const run = await runHarness({
    environment: {
      STAGING_SSH_TARGET: "user@same-host",
      PRODUCTION_SSH_TARGET: "user@same-host",
    },
  });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("resolve to the same SSH host");
  expect(run.calls).toEqual([]);
});

test("rejects different SSH users on the same explicit host", async () => {
  const run = await runHarness({
    environment: {
      STAGING_SSH_TARGET: "staging@shared-host",
      PRODUCTION_SSH_TARGET: "prod@SHARED-HOST.",
    },
  });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("same SSH host");
  expect(run.calls).toEqual([]);
});

test("rejects a staging override matching the existing production tier", async () => {
  const run = await runHarness({
    environment: { STAGING_SSH_TARGET: "prod-user@prod-host" },
    preExistingProduction: true,
  });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("prod-user@prod-host");
  expect(run.calls).toEqual([]);
});

test("rejects different hostnames that resolve to one address", async () => {
  const run = await runHarness({
    environment: {
      STAGING_SSH_TARGET: "staging@staging-dns-alias",
      PRODUCTION_SSH_TARGET: "prod@production-dns-alias",
    },
  });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("resolve to the same address");
  expect(run.calls).toEqual([]);
});

test("rejects separate addresses that identify the same machine", async () => {
  const run = await runHarness({
    environment: {
      STAGING_SSH_TARGET: "staging@tailscale-staging",
      PRODUCTION_SSH_TARGET: "prod@public-production",
      STUB_PRODUCTION_MACHINE_ID: "11111111111111111111111111111111",
    },
  });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("same machine identity");
  expect(run.calls).toEqual([]);
});

test("secret loading rejects a generic target and preserves a tier override", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-common-env-"));
  await mkdir(resolve(root, ".secrets"), { recursive: true });
  await Bun.write(resolve(root, ".secrets/root.env"), "TF_VAR_shared=value\n");
  await Bun.write(
    resolve(root, ".secrets/staging.env"),
    "SSH_TARGET=staging-target\n",
  );
  await Bun.write(
    resolve(root, ".secrets/prod.env"),
    "SSH_TARGET=production-target\n",
  );
  try {
    const child = Bun.spawn(
      [
        "bash",
        "-c",
        [
          'source "$1"',
          "get_repo_root() { printf '%s\\n' \"$COMMON_TEST_ROOT\"; }",
          "export SSH_TARGET=stale-staging-target",
          "unset PRODUCTION_SSH_TARGET",
          "if load_secrets_env prod; then exit 91; fi",
          "printf '%s\\n' generic-rejected",
          "unset SSH_TARGET",
          "unset STAGING_SSH_TARGET PRODUCTION_SSH_TARGET",
          "printf '%s\\n' SSH_TARGET=root-target > \"$COMMON_TEST_ROOT/.secrets/root.env\"",
          "if load_secrets_env prod; then exit 92; fi",
          "printf '%s\\n' root-generic-rejected",
          "printf '%s\\n' 'unset TF_VAR_stale' TF_VAR_shared=value > \"$COMMON_TEST_ROOT/.secrets/root.env\"",
          "export SSH_TARGET=explicit-target",
          "export STAGING_SSH_TARGET=explicit-target",
          "export TF_VAR_stale=stale",
          "load_secrets_env staging",
          `if [[ -n "\${TF_VAR_stale+x}" ]]; then exit 98; fi`,
          "printf '%s\\n' \"$SSH_TARGET\"",
          "printf '%s\\n' false TF_VAR_after=loaded > \"$COMMON_TEST_ROOT/.secrets/root.env\"",
          "unset SSH_TARGET STAGING_SSH_TARGET PRODUCTION_SSH_TARGET TF_VAR_after",
          "if load_secrets_env staging; then exit 93; fi",
          `if [[ -n "\${TF_VAR_after:-}" ]]; then exit 97; fi`,
          "printf '%s\\n' source-command-failure-rejected",
          "printf '%s\\n' 'TF_VAR_missing=$COMMON_TEST_MISSING' TF_VAR_after_missing=loaded > \"$COMMON_TEST_ROOT/.secrets/root.env\"",
          "unset COMMON_TEST_MISSING TF_VAR_after_missing",
          "if load_secrets_env staging; then exit 99; fi",
          `if [[ -n "\${TF_VAR_after_missing:-}" ]]; then exit 100; fi`,
          "printf '%s\\n' nounset-failure-rejected",
          "printf '%s\\n' 'false | true' TF_VAR_after_pipeline=loaded > \"$COMMON_TEST_ROOT/.secrets/root.env\"",
          "unset TF_VAR_after_pipeline",
          "if load_secrets_env staging; then exit 101; fi",
          `if [[ -n "\${TF_VAR_after_pipeline:-}" ]]; then exit 102; fi`,
          "printf '%s\\n' pipeline-failure-rejected",
          'rm "$COMMON_TEST_ROOT/.secrets/root.env"',
          'mkdir "$COMMON_TEST_ROOT/.secrets/root.env"',
          "unset SSH_TARGET STAGING_SSH_TARGET PRODUCTION_SSH_TARGET",
          "if load_secrets_env staging; then exit 94; fi",
          "printf '%s\\n' source-failure-rejected",
          "terraform() {",
          '  case "$*" in',
          "    *\"output -raw server_username\") printf '%s\\n' state-user ;;",
          "    *\"output -raw ssh_hostname\") printf '%s\\n' state-host ;;",
          "    *) return 95 ;;",
          "  esac",
          "}",
          "read_stack_ssh_target /unused",
          "terraform() {",
          '  case "$*" in',
          "    *\"state list\") printf '%s\\n' 'No state file was found!' >&2; return 1 ;;",
          "    *) return 1 ;;",
          "  esac",
          "}",
          "read_status=0",
          "read_stack_ssh_target /unused || read_status=$?",
          "printf 'no-state-status:%s\\n' \"$read_status\"",
          'if [[ "$read_status" -ne 2 ]]; then exit 96; fi',
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
    expect(stdout.trim().split("\n")).toEqual([
      "generic-rejected",
      "root-generic-rejected",
      "explicit-target",
      "source-command-failure-rejected",
      "nounset-failure-rejected",
      "pipeline-failure-rejected",
      "source-failure-rejected",
      "state-user@state-host",
      "no-state-status:2",
    ]);
    expect(stderr).toContain("PRODUCTION_SSH_TARGET");
    expect(stderr).toContain("root.env must not define SSH_TARGET");
    expect(stderr).toContain("exists but is not a regular file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
