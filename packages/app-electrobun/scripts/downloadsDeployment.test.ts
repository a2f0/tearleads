import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const wrapper = "terraform/scripts/run-downloads-stack.sh";
const lifecycleCheck = "scripts/checks/checkDownloadsDeployment.sh";

async function runScript(
  script: string,
  args: string[],
  options: {
    failInit?: boolean;
    tier?: string;
    before?: string;
    after?: string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "tearleads-downloads-deploy-"));
  async function write(path: string, source: string) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, source);
    chmodSync(target, 0o755);
  }
  try {
    await write(
      "bin/git",
      '#!/bin/sh\nprintf "%s\\n" "$DOWNLOADS_TEST_ROOT"\n',
    );
    await write(
      "terraform/scripts/common.sh",
      [
        'load_secrets_env() { echo secrets >> "$DOWNLOADS_TEST_LOG"; }',
        "validate_aws_env() { :; }",
        "get_backend_config() { echo /dev/null; }",
      ].join("\n"),
    );
    await write(
      "bin/terraform",
      [
        "#!/bin/sh",
        'printf "terraform %s\\n" "$*" >> "$DOWNLOADS_TEST_LOG"',
        '[ "$DOWNLOADS_TEST_FAIL_INIT" != true ] || [ "$2" != init ] || exit 8',
      ].join("\n"),
    );
    for (const tier of ["prod", "staging"]) {
      const stack = `terraform/stacks/${tier}/downloads`;
      mkdirSync(join(root, stack), { recursive: true });
      cpSync(
        join(repoRoot, stack, "versions.tf"),
        join(root, stack, "versions.tf"),
      );
      const config = await Bun.file(join(repoRoot, stack, "main.tf")).text();
      await write(
        `${stack}/main.tf`,
        tier === options.tier
          ? config.replace(options.before ?? "", options.after ?? "")
          : config,
      );
    }
    const log = join(root, "calls.log");
    const child = Bun.spawn(["bash", join(repoRoot, script), ...args], {
      env: {
        PATH: `${root}/bin:/usr/bin:/bin`,
        DOWNLOADS_TEST_ROOT: root,
        DOWNLOADS_TEST_LOG: log,
        DOWNLOADS_TEST_FAIL_INIT: String(options.failInit ?? false),
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
    return { exitCode, stderr, calls, root };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const args of [[], ["prod"], ["prod", "destroy"], ["unknown", "apply"]]) {
  test(`downloads wrapper rejects ${args.join(" ")} before credentials or Terraform`, async () => {
    const result = await runScript(wrapper, args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.calls).toEqual([]);
  });
}

for (const [tier, action, args] of [
  ["prod", "plan", ["-out=review.tfplan"]],
  ["prod", "apply", ["review.tfplan"]],
  ["staging", "output", ["-json", "bucket"]],
  ["staging", "destroy", []],
  ["staging", "destroy", ["-auto-approve"]],
] as const) {
  test(`downloads ${tier} ${action} uses independent state and preserves arguments`, async () => {
    const result = await runScript(wrapper, [tier, action, ...args]);
    const terraform = `terraform -chdir=${result.root}/terraform/stacks/${tier}/downloads`;
    const input =
      action === "plan" || action === "apply" ? ["-input=false"] : [];
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls).toEqual([
      "secrets",
      `${terraform} init -input=false -reconfigure -backend-config=/dev/null`,
      [terraform, action, ...input, ...args].join(" "),
    ]);
  });
}

test("failed downloads initialization prevents apply", async () => {
  const result = await runScript(wrapper, ["staging", "apply"], {
    failInit: true,
  });
  expect(result.exitCode).toBe(8);
  expect(result.calls).toHaveLength(2);
  expect(result.calls[1]).toContain(" init ");
});

test("downloads lifecycle policy accepts the production and staging roots", async () => {
  const result = await runScript(lifecycleCheck, []);
  expect(result.exitCode, result.stderr).toBe(0);
});

for (const [tier, before, after] of [
  ["prod", "prevent_destroy = true", "prevent_destroy = false"],
  ["prod", "force_destroy = false", "force_destroy = true"],
  ["staging", "force_destroy = true", "force_destroy = false"],
  ["staging", "downloads-staging.tearleads.com", "downloads.tearleads.com"],
]) {
  test(`downloads lifecycle policy rejects ${tier} ${after}`, async () => {
    const result = await runScript(lifecycleCheck, [], { tier, before, after });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ERROR:");
  });
}
