import { expect, test } from "bun:test";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const nativeReleaseScript = resolve(
  import.meta.dir,
  "../../../scripts/release/nativeRelease.sh",
);
const stagingAndroidWrapper = resolve(
  import.meta.dir,
  "../../../scripts/release/buildAndroidStagingRelease.sh",
);

function environmentValue(name: string) {
  return process.env[name];
}

test("the shared native release runner rejects an invalid target", async () => {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; native_release_main desktop build staging',
      "sh",
      nativeReleaseScript,
    ],
    { stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain(
    "invalid native release target desktop:build:staging",
  );
});

test("help still rejects an invalid native release target", async () => {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; native_release_main desktop build staging --help',
      "sh",
      nativeReleaseScript,
    ],
    { stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain(
    "invalid native release target desktop:build:staging",
  );
});

test("the shared runner guards and exports its tier before building", async () => {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "tearleads-native-release-command-"),
  );
  const bunStub = resolve(temporaryDirectory, "bun");
  const logPath = resolve(temporaryDirectory, "release.log");
  await Bun.write(
    bunStub,
    [
      "#!/bin/sh",
      'printf \'bun:%s:%s\\n\' "$NATIVE_RELEASE_TIER" "$*" >> "$NATIVE_RELEASE_TEST_LOG"',
    ].join("\n"),
  );
  await chmod(bunStub, 0o755);

  try {
    const child = Bun.spawn(
      [
        "sh",
        "-c",
        `set -eu
. "$1"
native_release_guard_environment() {
  printf 'guard:%s:%s\\n' "$1" "$2" >> "$NATIVE_RELEASE_TEST_LOG"
  export VITE_API_BASE_URL=https://api-staging.tearleads.com
}
native_release_link_secrets() {
  printf 'secrets:%s\\n' "$NATIVE_RELEASE_TIER" >> "$NATIVE_RELEASE_TEST_LOG"
}
native_release_ensure_android_wrapper() {
  printf 'wrapper\\n' >> "$NATIVE_RELEASE_TEST_LOG"
}
native_release_main android build staging build_number:42`,
        stagingAndroidWrapper,
        nativeReleaseScript,
      ],
      {
        env: {
          ...process.env,
          NATIVE_RELEASE_TEST_LOG: logPath,
          PATH: `${temporaryDirectory}:${environmentValue("PATH") ?? ""}`,
        },
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    await expect(Bun.file(logPath).text()).resolves.toBe(
      [
        "secrets:staging",
        "guard:android:staging",
        "wrapper",
        "bun:staging:run android:build-release:staging build_number:42",
        "",
      ].join("\n"),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the shared runner links a fresh clone's secrets at its root unless overridden", async () => {
  const workspace = await realpath(
    await mkdtemp(resolve(tmpdir(), "tearleads-native-secrets-")),
  );
  const clone = resolve(workspace, "clone");
  const releaseScripts = resolve(clone, "scripts/release");
  await mkdir(resolve(clone, ".git"), { recursive: true });
  await mkdir(releaseScripts, { recursive: true });
  await mkdir(resolve(clone, "scripts/lib"), { recursive: true });
  await cp(
    resolve(nativeReleaseScript, "../../lib/secretsStore.sh"),
    resolve(clone, "scripts/lib/secretsStore.sh"),
  );
  await mkdir(resolve(workspace, "matrix-secrets/tearleads/prod"), {
    recursive: true,
  });
  // As native_release_main sets it: the wrapper's own scripts/release folder.
  const link = (secretsDirOverride: string) =>
    Bun.spawnSync(
      [
        "sh",
        "-c",
        'set -eu\n. "$1"\nnative_script_dir="$2"\nnative_release_link_secrets',
        "sh",
        nativeReleaseScript,
        releaseScripts,
      ],
      {
        env: {
          PATH: environmentValue("PATH"),
          NATIVE_RELEASE_SECRETS_DIR: secretsDirOverride,
        },
      },
    );

  try {
    const overridden = link("../elsewhere");
    expect(overridden.exitCode, overridden.stderr.toString()).toBe(0);
    expect(overridden.stdout.toString()).toBe("");
    await expect(lstat(resolve(clone, ".secrets"))).rejects.toThrow("ENOENT");

    const linked = link(" ");
    expect(linked.exitCode, linked.stderr.toString()).toBe(0);
    expect(await readlink(resolve(clone, ".secrets"))).toBe(
      "../matrix-secrets/tearleads",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
