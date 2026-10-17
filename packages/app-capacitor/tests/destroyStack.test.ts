import { expect, test } from "bun:test";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const overrideName = "greenfield_reset_override.tf";

async function writeExecutable(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, source);
  await chmod(path, 0o755);
}

interface Scenario {
  readonly tier: "staging" | "prod";
  readonly stack: string;
  readonly failure?: "plan" | "apply";
  readonly existingOverride?: string;
  readonly authorization?: string;
}

// Runs destroy-stack.sh against a copy of the real stack configuration. The
// wrapper stub records each call and, at plan time, a copy of the override.
async function destroyStack({
  tier,
  stack,
  failure,
  existingOverride,
  authorization = tier,
}: Scenario) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-destroy-stack-"));
  const stackDir = resolve(root, "terraform/stacks", tier, stack);
  const log = resolve(root, "calls.log");
  try {
    for (const path of [
      "terraform/scripts/destroy-stack.sh",
      "terraform/scripts/teardownGuard.sh",
    ]) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await cp(resolve(repoRoot, path), resolve(root, path));
    }
    await cp(resolve(repoRoot, "terraform/stacks", tier, stack), stackDir, {
      recursive: true,
      filter: (source) => !source.includes("/.terraform"),
    });
    if (existingOverride !== undefined)
      await Bun.write(resolve(stackDir, overrideName), existingOverride);
    await writeExecutable(
      resolve(root, "bin/git"),
      '#!/bin/sh\nprintf "%s\\n" "$STACK_TEST_ROOT"\n',
    );
    await writeExecutable(
      resolve(root, `terraform/scripts/run-${stack}-stack.sh`),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$STACK_TEST_LOG"',
        `if [ "$2" = plan ]; then cp "$STACK_TEST_DIR/${overrideName}" "$STACK_TEST_ROOT/override-at-plan.tf" 2>/dev/null || :; fi`,
        '[ "$STACK_TEST_FAILURE" != "$2" ] || exit 9',
      ].join("\n"),
    );
    const child = Bun.spawn(
      [
        "bash",
        resolve(root, "terraform/scripts/destroy-stack.sh"),
        tier,
        stack,
      ],
      {
        env: {
          PATH: `${root}/bin:/usr/bin:/bin`,
          TMPDIR: root,
          STACK_TEST_ROOT: root,
          STACK_TEST_DIR: stackDir,
          STACK_TEST_LOG: log,
          STACK_TEST_FAILURE: failure ?? "",
          TEARLEADS_TEARDOWN_TIER: authorization,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    const calls = (await readFile(log, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean);
    const overrideAtPlan = await readFile(
      resolve(root, "override-at-plan.tf"),
      "utf8",
    ).catch(() => undefined);
    const overrideAfter = await readFile(
      resolve(stackDir, overrideName),
      "utf8",
    ).catch(() => undefined);
    const plan = calls[0]?.match(/-out=(\S+)$/)?.[1];
    const planDirRemains =
      plan !== undefined &&
      (await stat(dirname(plan)).then(
        () => true,
        () => false,
      ));
    return {
      exitCode,
      stderr,
      calls,
      plan,
      overrideAtPlan,
      overrideAfter,
      planDirRemains,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// "<type>.<name>" for every block the override lifts protection from.
function liftedAddresses(override: string | undefined) {
  return [
    ...(override ?? "").matchAll(
      /resource "([^"]+)" "([^"]+)" \{\n {2}lifecycle \{\n {4}prevent_destroy = false\n {2}\}\n\}/g,
    ),
  ].map(([, type, name]) => `${type}.${name}`);
}

test("a staging stack is destroyed by applying exactly its saved destroy plan", async () => {
  const result = await destroyStack({ tier: "staging", stack: "edge" });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.plan).toMatch(/\/destroy\.tfplan$/);
  expect(result.calls).toEqual([
    `staging plan -destroy -out=${result.plan}`,
    `staging apply ${result.plan}`,
  ]);
  expect(result.overrideAtPlan).toBeUndefined();
  expect(result.planDirRemains).toBe(false);
});

for (const [stack, addresses] of [
  [
    "postgres",
    [
      "restapi_object.database",
      "restapi_object.main_protection",
      "planetscale_postgres_branch_role.runtime",
      "planetscale_postgres_branch_role.migrations",
    ],
  ],
  ["storage", ["cloudflare_r2_bucket.blobs"]],
  ["downloads", ["cloudflare_r2_bucket.downloads"]],
  ["edge", []],
  ["website", []],
] as const) {
  test(`production ${stack} lifts prevent_destroy for exactly its protected resources`, async () => {
    const result = await destroyStack({ tier: "prod", stack });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls).toEqual([
      `prod plan -destroy -out=${result.plan}`,
      `prod apply ${result.plan}`,
    ]);
    expect(liftedAddresses(result.overrideAtPlan).sort()).toEqual(
      [...addresses].sort(),
    );
    if (addresses.length === 0) expect(result.overrideAtPlan).toBeUndefined();
    expect(result.overrideAfter).toBeUndefined();
    expect(result.planDirRemains).toBe(false);
  });
}

for (const failure of ["plan", "apply"] as const) {
  test(`a failed production ${failure} still removes the override and plan`, async () => {
    const result = await destroyStack({
      tier: "prod",
      stack: "storage",
      failure,
    });
    expect(result.exitCode).toBe(9);
    expect(liftedAddresses(result.overrideAtPlan)).toEqual([
      "cloudflare_r2_bucket.blobs",
    ]);
    expect(result.overrideAfter).toBeUndefined();
    expect(result.planDirRemains).toBe(false);
  });
}

test("an override left by an earlier run stops the teardown and is kept", async () => {
  const leftover = "# left by an interrupted run\n";
  const result = await destroyStack({
    tier: "prod",
    stack: "postgres",
    existingOverride: leftover,
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`${overrideName} already exists`);
  expect(result.calls).toEqual([]);
  expect(result.overrideAfter).toBe(leftover);
});

test("an unauthorized production run writes no override", async () => {
  const result = await destroyStack({
    tier: "prod",
    stack: "postgres",
    authorization: "",
  });
  expect(result.exitCode).toBe(1);
  expect(result.calls).toEqual([]);
  expect(result.overrideAfter).toBeUndefined();
});

for (const args of [
  [],
  ["prod"],
  ["prod", "continuity"],
  ["unknown", "edge"],
]) {
  test(`destroy-stack rejects ${JSON.stringify(args)} before running Terraform`, async () => {
    // A fixture root, so a regression here can never reach a real wrapper.
    const root = await mkdtemp(resolve(tmpdir(), "tearleads-destroy-args-"));
    try {
      for (const path of [
        "terraform/scripts/destroy-stack.sh",
        "terraform/scripts/teardownGuard.sh",
      ]) {
        await mkdir(dirname(resolve(root, path)), { recursive: true });
        await cp(resolve(repoRoot, path), resolve(root, path));
      }
      await writeExecutable(
        resolve(root, "bin/git"),
        `#!/bin/sh\nprintf "%s\\n" '${root}'\n`,
      );
      const child = Bun.spawn(
        ["bash", resolve(root, "terraform/scripts/destroy-stack.sh"), ...args],
        {
          env: {
            PATH: `${root}/bin:/usr/bin:/bin`,
            TEARLEADS_TEARDOWN_TIER: "prod",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/Usage:|Unknown teardown tier/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
