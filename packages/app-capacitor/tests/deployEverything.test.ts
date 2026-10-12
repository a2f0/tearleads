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
  "scripts/deployStaging.sh",
  "scripts/uploadIosStagingRelease.sh",
  "scripts/uploadAndroidStagingRelease.sh",
  "scripts/deployProduction.sh",
  "scripts/uploadIosRelease.sh",
  "scripts/uploadAndroidRelease.sh",
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

async function runHarness(failAt?: string): Promise<HarnessRun> {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-deploy-everything-"));
  const script = resolve(root, "scripts/deployEverything.sh");
  const logPath = resolve(root, "calls.log");

  await mkdir(resolve(root, "scripts/lib"), { recursive: true });
  await cp(sourceScript, script);
  await cp(
    resolve(dirname(sourceScript), "lib/stepTimings.sh"),
    resolve(root, "scripts/lib/stepTimings.sh"),
  );
  await chmod(script, 0o755);
  for (const path of commandPaths) {
    await writeExecutable(
      resolve(root, path),
      [
        "#!/bin/sh",
        `printf '%s|%s\\n' "$(basename "$0")" "$PWD" >> "$DEPLOY_EVERYTHING_LOG"`,
        `[ "$(basename "$0")" != "\${DEPLOY_EVERYTHING_FAIL_AT:-}" ] || exit 9`,
      ].join("\n"),
    );
  }

  try {
    const child = Bun.spawn([script], {
      cwd: tmpdir(),
      env: {
        ...process.env,
        PATH: environmentValue("PATH") ?? "",
        DEPLOY_EVERYTHING_LOG: logPath,
        DEPLOY_EVERYTHING_FAIL_AT: failAt ?? "",
      },
      stdout: "pipe",
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
  expect(run.calls.map((call) => call.split("|")[0])).toEqual([
    "deployStaging.sh",
    "uploadIosStagingRelease.sh",
    "uploadAndroidStagingRelease.sh",
    "deployProduction.sh",
    "uploadIosRelease.sh",
    "uploadAndroidRelease.sh",
  ]);
  const workingDirectories = new Set(
    run.calls.map((call) => call.split("|").slice(1).join("|")),
  );
  expect(workingDirectories).toEqual(new Set([run.root]));
});

test("stops at the first failing release command", async () => {
  const run = await runHarness("uploadAndroidStagingRelease.sh");
  expect(run.exitCode).not.toBe(0);
  expect(run.calls.map((call) => call.split("|")[0])).toEqual([
    "deployStaging.sh",
    "uploadIosStagingRelease.sh",
    "uploadAndroidStagingRelease.sh",
  ]);
});

test("secret loading layers tier files and rejects broken sources", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-common-env-"));
  await mkdir(resolve(root, ".secrets"), { recursive: true });
  await Bun.write(
    resolve(root, ".secrets/root.env"),
    "unset TF_VAR_stale\nTF_VAR_shared=value\n",
  );
  await Bun.write(
    resolve(root, ".secrets/staging.env"),
    "TF_VAR_tier=staging\n",
  );
  await Bun.write(
    resolve(root, ".secrets/staging.worker.env"),
    "export DOCUMENT_SYNC_CURSOR_HMAC_KEY=generated-worker-secret\n",
  );
  try {
    const child = Bun.spawn(
      [
        "bash",
        "-c",
        [
          'source "$1"',
          "get_repo_root() { printf '%s\\n' \"$COMMON_TEST_ROOT\"; }",
          "export TF_VAR_stale=stale",
          "load_secrets_env staging",
          `if [[ -n "\${TF_VAR_stale+x}" ]]; then exit 98; fi`,
          'printf \'%s|%s|%s\\n\' "$TF_VAR_shared" "$TF_VAR_tier" "$DOCUMENT_SYNC_CURSOR_HMAC_KEY"',
          "if load_secrets_env unknown; then exit 91; fi",
          "printf '%s\\n' unknown-tier-rejected",
          "printf '%s\\n' false TF_VAR_after=loaded > \"$COMMON_TEST_ROOT/.secrets/root.env\"",
          "unset TF_VAR_after",
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
          "original_path=$PATH",
          "printf '%s\\n' PATH=/definitely/missing TF_VAR_path_snapshot=loaded > \"$COMMON_TEST_ROOT/.secrets/root.env\"",
          "unset TF_VAR_path_snapshot",
          '_source_env_file "$COMMON_TEST_ROOT/.secrets/root.env"',
          "path_snapshot_value=$TF_VAR_path_snapshot",
          "PATH=$original_path",
          "export PATH",
          "printf 'path-snapshot:%s\\n' \"$path_snapshot_value\"",
          'rm "$COMMON_TEST_ROOT/.secrets/root.env"',
          'mkdir "$COMMON_TEST_ROOT/.secrets/root.env"',
          "if load_secrets_env staging; then exit 94; fi",
          "printf '%s\\n' source-failure-rejected",
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
      "value|staging|generated-worker-secret",
      "unknown-tier-rejected",
      "source-command-failure-rejected",
      "nounset-failure-rejected",
      "pipeline-failure-rejected",
      "path-snapshot:loaded",
      "source-failure-rejected",
    ]);
    expect(stderr).toContain("Unknown deployment tier: unknown");
    expect(stderr).toContain("exists but is not a regular file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
