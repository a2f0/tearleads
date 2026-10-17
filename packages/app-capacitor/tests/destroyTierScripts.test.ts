import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const domain = "fixture.test";

type Tier = "staging" | "prod";

// destroy_tier's steps in order, as [timing label, script, arguments].
function teardownSteps(tier: Tier) {
  return [
    ["edge", "terraform/scripts/destroy-stack.sh", `${tier} edge`],
    ["api", "packages/api/scripts/destroyApi.sh", tier],
    ["app-web", "packages/app-web/scripts/destroyAppWeb.sh", tier],
    ["postgres-objects", "terraform/scripts/drop-postgres-owned.sh", tier],
    ["postgres", "terraform/scripts/destroy-stack.sh", `${tier} postgres`],
    ["blobs-empty", "terraform/scripts/empty-r2-bucket.sh", `${tier} storage`],
    ["storage", "terraform/scripts/destroy-stack.sh", `${tier} storage`],
    [
      "downloads-empty",
      "terraform/scripts/empty-r2-bucket.sh",
      `${tier} downloads`,
    ],
    ["downloads", "terraform/scripts/destroy-stack.sh", `${tier} downloads`],
    ["website", "packages/website/scripts/destroyWebsite.sh", tier],
  ] as const;
}

// Each stub logs "<script>|<arguments>|<production authorization>".
function stepCalls(tier: Tier, authorization: string) {
  return teardownSteps(tier).map(
    ([, path, args]) => `${path}|${args}|${authorization}`,
  );
}

async function writeExecutable(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, source);
  await chmod(path, 0o755);
}

async function readCalls(log: string) {
  return (await readFile(log, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean);
}

async function runTeardown(
  script: string,
  args: string[],
  input = "",
  failingStep = "",
) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-destroy-tier-"));
  const log = resolve(root, "calls.log");
  try {
    for (const path of [
      script,
      "scripts/lib/destroyTier.sh",
      "scripts/lib/stepTimings.sh",
    ]) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await cp(resolve(repoRoot, path), resolve(root, path));
    }
    await writeExecutable(
      resolve(root, "bin/git"),
      '#!/bin/sh\nprintf "%s\\n" "$DESTROY_TEST_ROOT"\n',
    );
    await writeExecutable(
      resolve(root, "terraform/scripts/common.sh"),
      [
        'load_secrets_env() { echo "secrets|$1" >> "$DESTROY_TEST_LOG"; export TF_VAR_domain=fixture.test; }',
        'validate_domain_env() { [ -n "$TF_VAR_domain" ]; }',
      ].join("\n"),
    );
    for (const [, path] of teardownSteps("staging")) {
      await writeExecutable(
        resolve(root, path),
        [
          "#!/bin/sh",
          `printf '%s|%s|%s\\n' '${path}' "$*" "\${TEARLEADS_TEARDOWN_TIER:-}" >> "$DESTROY_TEST_LOG"`,
          `[ "$DESTROY_TEST_FAILURE" != '${path} '"$*" ] || exit 9`,
        ].join("\n"),
      );
    }
    const child = Bun.spawn(["bash", resolve(root, script), ...args], {
      cwd: root,
      env: {
        PATH: `${root}/bin:/usr/bin:/bin`,
        DESTROY_TEST_ROOT: root,
        DESTROY_TEST_LOG: log,
        DESTROY_TEST_FAILURE: failingStep,
      },
      stdin: input === "" ? "ignore" : new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, calls: await readCalls(log) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const staging = "scripts/destroyStaging.sh";
const production = "scripts/destroyProduction.sh";

for (const [label, args, input] of [
  ["--auto-approve", ["--auto-approve"], ""],
  ["a typed confirmation", [], "staging\n"],
] as const) {
  test(`staging teardown with ${label} runs and times every step in order`, async () => {
    const result = await runTeardown(staging, [...args], input);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls).toEqual(stepCalls("staging", ""));
    expect(result.stdout).toContain("--- Timing summary ---");
    for (const [step] of teardownSteps("staging"))
      expect(result.stdout).toMatch(
        new RegExp(`^ {2}${step} +\\dm\\d\\ds$`, "m"),
      );
    expect(result.stdout).toMatch(/^ {2}total +\dm\d\ds$/m);
  });
}

for (const [label, input] of [
  ["a declined confirmation", "no\n"],
  ["no input", ""],
] as const) {
  test(`staging teardown with ${label} changes nothing`, async () => {
    const result = await runTeardown(staging, [], input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Teardown cancelled");
    expect(result.calls).toEqual([]);
  });
}

for (const argument of ["-target=module.server", "prod"]) {
  test(`staging teardown rejects ${argument} before changing infrastructure`, async () => {
    const result = await runTeardown(staging, [argument]);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
}

test("production teardown runs every step only after the domain is typed", async () => {
  const result = await runTeardown(production, [], `${domain}\n`);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stderr).toContain(`Type the production domain (${domain})`);
  expect(result.calls).toEqual(["secrets|prod", ...stepCalls("prod", "prod")]);
  expect(result.stdout).toContain("--- Timing summary ---");
});

for (const args of [["--auto-approve"], ["-auto-approve"], ["prod"]]) {
  test(`production teardown rejects ${args.join(" ")} before reading secrets`, async () => {
    const result = await runTeardown(production, args, `${domain}\n`);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
}

for (const input of ["", "\n", "production\n", "staging\n", "yes\n"]) {
  test(`production teardown answered ${JSON.stringify(input)} changes nothing`, async () => {
    const result = await runTeardown(production, [], input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Teardown cancelled");
    expect(result.calls).toEqual(["secrets|prod"]);
  });
}

test("a failed step stops the teardown and still prints its timings", async () => {
  const result = await runTeardown(
    staging,
    ["--auto-approve"],
    "",
    "terraform/scripts/drop-postgres-owned.sh staging",
  );
  expect(result.exitCode).toBe(9);
  expect(result.calls).toEqual(stepCalls("staging", "").slice(0, 4));
  expect(result.stderr).toContain("Teardown stopped in [postgres-objects]");
  expect(result.stdout).toContain("--- Timing summary ---");
  expect(result.stdout).toMatch(/^ {2}app-web +\dm\d\ds$/m);
  expect(result.stdout).not.toMatch(/^ {2}postgres-objects /m);
});

// Every teardown step that can delete production data. Each must refuse prod
// unless destroyProduction.sh authorized it, before loading any credential.
const guardedSteps = [
  ["terraform/scripts/destroy-stack.sh", ["edge"]],
  ["terraform/scripts/drop-postgres-owned.sh", []],
  ["terraform/scripts/empty-r2-bucket.sh", ["storage"]],
  ["packages/api/scripts/destroyApi.sh", []],
  ["packages/app-web/scripts/destroyAppWeb.sh", []],
  ["packages/website/scripts/destroyWebsite.sh", []],
] as const;

async function runGuardedStep(
  script: string,
  args: readonly string[],
  authorization: string,
) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-teardown-guard-"));
  const log = resolve(root, "calls.log");
  const record = '"$(basename "$0")|$*" >> "$GUARD_TEST_LOG"';
  try {
    for (const path of [script, "terraform/scripts/teardownGuard.sh"]) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await cp(resolve(repoRoot, path), resolve(root, path));
    }
    await writeExecutable(
      resolve(root, "bin/git"),
      '#!/bin/sh\nprintf "%s\\n" "$GUARD_TEST_ROOT"\n',
    );
    for (const command of ["bun", "bunx", "terraform", "aws"])
      await writeExecutable(
        resolve(root, "bin", command),
        `#!/bin/sh\nprintf '%s\\n' ${record}\n`,
      );
    for (const stack of ["edge", "postgres", "storage", "website"])
      await writeExecutable(
        resolve(root, `terraform/scripts/run-${stack}-stack.sh`),
        `#!/bin/sh\nprintf '%s\\n' ${record}\necho '{}'\n`,
      );
    if (script !== "terraform/scripts/destroy-stack.sh")
      await writeExecutable(
        resolve(root, "terraform/scripts/destroy-stack.sh"),
        `#!/bin/sh\nprintf '%s\\n' ${record}\n`,
      );
    await mkdir(resolve(root, "terraform/stacks/prod/edge"), {
      recursive: true,
    });
    await Bun.write(
      resolve(root, "terraform/stacks/prod/edge/main.tf"),
      'locals {\n  edge = "fixture"\n}\n',
    );
    for (const directory of ["api", "api-shared", "app-web", "website"])
      await mkdir(resolve(root, "packages", directory), { recursive: true });
    await writeExecutable(
      resolve(root, "terraform/scripts/common.sh"),
      [
        'load_secrets_env() { echo "secrets|$1" >> "$GUARD_TEST_LOG"; }',
        "export_wrangler_env() { :; }",
        "validate_tf_state_env() { :; }",
        "validate_cloudflare_env() { :; }",
      ].join("\n"),
    );
    const child = Bun.spawn(["bash", resolve(root, script), "prod", ...args], {
      cwd: root,
      env: {
        PATH: `${root}/bin:/usr/bin:/bin`,
        GUARD_TEST_ROOT: root,
        GUARD_TEST_LOG: log,
        ...(authorization ? { TEARLEADS_TEARDOWN_TIER: authorization } : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stderr, calls: await readCalls(log) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const [script, args] of guardedSteps) {
  for (const authorization of ["", "staging"]) {
    test(`${script} refuses production ${authorization ? `authorized for ${authorization}` : "without authorization"}`, async () => {
      const result = await runGuardedStep(script, args, authorization);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Production is destroyed only through scripts/destroyProduction.sh",
      );
      expect(result.calls).toEqual([]);
    });
  }

  test(`${script} proceeds past the guard once production is authorized`, async () => {
    const result = await runGuardedStep(script, args, "prod");
    expect(result.stderr).not.toContain("destroyProduction.sh");
    expect(result.calls.length).toBeGreaterThan(0);
  });
}

test("production Worker teardown deletes the production Workers", async () => {
  const api = await runGuardedStep(
    "packages/api/scripts/destroyApi.sh",
    [],
    "prod",
  );
  expect(api.exitCode, api.stderr).toBe(0);
  expect(api.calls).toEqual([
    "secrets|prod",
    "bunx|--no-install wrangler delete --env prod --force",
  ]);
  const appWeb = await runGuardedStep(
    "packages/app-web/scripts/destroyAppWeb.sh",
    [],
    "prod",
  );
  expect(appWeb.exitCode, appWeb.stderr).toBe(0);
  expect(appWeb.calls).toEqual([
    "secrets|prod",
    "bun|run destroy:app --env prod --force",
    "bun|run destroy:demo --env prod --force",
  ]);
});
