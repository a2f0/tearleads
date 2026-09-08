import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

async function runStorageScript(
  scriptPath: string,
  args: string[],
  failure = "",
) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-storage-deploy-"));
  async function executable(path: string, source: string) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, source);
    await chmod(path, 0o755);
  }
  try {
    const script = resolve(root, scriptPath);
    await mkdir(dirname(script), { recursive: true });
    await cp(resolve(import.meta.dir, "../../..", scriptPath), script);
    await executable(
      resolve(root, "bin/git"),
      '#!/bin/sh\nprintf "%s\\n" "$STORAGE_TEST_ROOT"\n',
    );
    if (scriptPath !== "terraform/scripts/run-storage-stack.sh") {
      await executable(
        resolve(root, "terraform/scripts/run-storage-stack.sh"),
        [
          "#!/bin/sh",
          'printf "storage %s\\n" "$*" >> "$STORAGE_TEST_LOG"',
          '[ "$STORAGE_TEST_FAILURE" != storage ] || exit 8',
        ].join("\n"),
      );
    }
    await executable(
      resolve(root, "terraform/scripts/common.sh"),
      [
        'load_secrets_env() { echo secrets >> "$STORAGE_TEST_LOG"; }',
        "validate_aws_env() { :; }",
        "get_backend_config() { echo /dev/null; }",
      ].join("\n"),
    );
    await executable(
      resolve(root, "bin/terraform"),
      '#!/bin/sh\nprintf "terraform %s\\n" "$*" >> "$STORAGE_TEST_LOG"\n',
    );
    await executable(
      resolve(root, "terraform/stacks/staging/server/scripts/destroy.sh"),
      [
        "#!/bin/sh",
        'printf "server %s\\n" "$*" >> "$STORAGE_TEST_LOG"',
        '[ "$STORAGE_TEST_FAILURE" != server ] || exit 9',
      ].join("\n"),
    );
    const log = resolve(root, "calls.log");
    const child = Bun.spawn(["bash", script, ...args], {
      env: {
        PATH: `${root}/bin:/usr/bin:/bin`,
        STORAGE_TEST_ROOT: root,
        STORAGE_TEST_LOG: log,
        STORAGE_TEST_FAILURE: failure,
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    const calls = (await Bun.file(log).exists())
      ? (await Bun.file(log).text()).trim().split("\n")
      : [];
    return { exitCode, stderr, calls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("production deployment only reads existing storage", async () => {
  const result = await runStorageScript(
    "terraform/scripts/prepare-storage.sh",
    ["prod"],
  );
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual(["storage prod output -json bucket"]);
});

test("production preparation fails when storage has not been provisioned", async () => {
  const result = await runStorageScript(
    "terraform/scripts/prepare-storage.sh",
    ["prod"],
    "storage",
  );
  expect(result.exitCode).toBe(8);
});

test("staging deployment provisions disposable storage", async () => {
  const result = await runStorageScript(
    "terraform/scripts/prepare-storage.sh",
    ["staging"],
  );
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual(["storage staging apply -auto-approve"]);
});

test("staging teardown removes its server before emptying storage", async () => {
  const result = await runStorageScript("scripts/destroyStaging.sh", [
    "--auto-approve",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual([
    "server --auto-approve",
    "storage staging destroy --auto-approve",
  ]);
});

test("failed server teardown retains staging storage", async () => {
  const result = await runStorageScript(
    "scripts/destroyStaging.sh",
    ["--auto-approve"],
    "server",
  );
  expect(result.exitCode).toBe(9);
  expect(result.calls).toEqual(["server --auto-approve"]);
});

for (const args of [
  ["prod", "destroy"],
  ["unknown", "apply"],
]) {
  test(`storage wrapper rejects ${args.join(" ")} before loading credentials`, async () => {
    const result = await runStorageScript(
      "terraform/scripts/run-storage-stack.sh",
      args,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.calls).toEqual([]);
  });
}

for (const argument of ["-target=module.server", "-var-file=server.tfvars"]) {
  test(`full staging teardown rejects ${argument} before changing infrastructure`, async () => {
    const result = await runStorageScript("scripts/destroyStaging.sh", [
      argument,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
}
