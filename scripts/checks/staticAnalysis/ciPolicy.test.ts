import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { ciDiffRange, ciScopes } from "../ciPolicy";

const repoRoot = resolve(import.meta.dir, "../../..");

function assertCiSuccess(needs: unknown) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "node_modules/.bin/agent-tool",
      "ci",
      "gate",
      "-",
      "--policy",
      "scripts/checks/ciGate.json",
    ],
    {
      cwd: repoRoot,
      stdin: Buffer.from(JSON.stringify(needs)),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) {
    const report = JSON.parse(result.stdout.toString());
    throw new Error(report.errors.join("\n"));
  }
}

const successful = () => ({
  changes: {
    result: "success",
    outputs: { native: "false", proofs: "false", terraform: "false" },
  },
  lint: { result: "success" },
  build: { result: "success" },
  test: { result: "success" },
  "postgres-concurrency": { result: "success" },
  windows: { result: "success" },
  native: { result: "skipped" },
  proofs: { result: "skipped" },
  terraform: { result: "skipped" },
});

test("required native, Lean proof, and Terraform jobs must succeed, never skip", () => {
  for (const job of ["native", "proofs", "terraform"]) {
    const needs = successful();
    needs.changes.outputs = { ...needs.changes.outputs, [job]: "true" };
    expect(() => assertCiSuccess(needs)).toThrow(
      new RegExp(`^${job}: expected (?:success|skipped)[.,]`, "m"),
    );
    expect(() =>
      assertCiSuccess({
        ...needs,
        [job]: { result: "success" },
      }),
    ).not.toThrow();
    for (const result of ["failure", "cancelled", "pending"]) {
      expect(() => assertCiSuccess({ ...needs, [job]: { result } })).toThrow(
        job,
      );
    }
  }
});

test("diff selection validates SHAs and defaults to all scopes without a base", () => {
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  expect(ciDiffRange(base, head)).toBe(`${base}...${head}`);
  for (const missing of [undefined, "", "0".repeat(40)]) {
    expect(ciDiffRange(missing, head)).toBeUndefined();
  }
  for (const invalid of [
    undefined,
    "",
    "main",
    "--output=bad",
    "c".repeat(39),
  ]) {
    expect(() => ciDiffRange(base, invalid)).toThrow("full base and head");
  }
  expect(() => ciDiffRange("main", head)).toThrow("full base and head");
});

test("requires every applicable check and permits only explicitly irrelevant skips", () => {
  expect(() => assertCiSuccess(successful())).not.toThrow();
  for (const job of Object.keys(successful())) {
    for (const result of ["failure", "cancelled", "pending"]) {
      expect(() =>
        assertCiSuccess({ ...successful(), [job]: { result } }),
      ).toThrow(new RegExp(`^${job}: expected (?:success|skipped)[.,]`, "m"));
    }
  }
  for (const job of [
    "changes",
    "lint",
    "build",
    "test",
    "postgres-concurrency",
    "windows",
  ]) {
    expect(() =>
      assertCiSuccess({ ...successful(), [job]: { result: "skipped" } }),
    ).toThrow(new RegExp(`^${job}: expected (?:success|skipped)[.,]`, "m"));
  }
  expect(() => assertCiSuccess({})).toThrow();
  expect(() =>
    assertCiSuccess({ ...successful(), changes: { result: "success" } }),
  ).toThrow();
});

test("selects native, proof, and infrastructure checks without skipping their dependencies", () => {
  expect(ciScopes(["docs/example.md"])).toEqual({
    native: false,
    proofs: false,
    terraform: false,
  });
  expect(ciScopes(["packages/app-capacitor/ios/App/App.swift"]).native).toBe(
    true,
  );
  for (const path of [
    "scripts/checks/testNativePurchaseBridge.sh",
    // The Android build renders its launcher and splash images from these.
    "assets/brand/logo.svg",
    "agent-tool.json",
    "scripts/lib/buildBrandImages.sh",
  ]) {
    expect(ciScopes([path]).native).toBe(true);
  }
  for (const path of [
    "formal/lean/Tearleads/Transparency/Verify.lean",
    "formal/lean/vectors/transparency.json",
    "scripts/protocol/generateTransparencyVectors.ts",
    "scripts/protocol/leanTools.ts",
  ]) {
    expect(ciScopes([path]).proofs).toBe(true);
  }
  // The replay suite in Lint covers production changes against the committed
  // vectors, so neither the TypeScript verifier nor the TLA+ models need Lean.
  for (const path of [
    "packages/crypto/src/keying/transparencyProofs.ts",
    "formal/document-sync/BaselineDominance.tla",
  ]) {
    expect(ciScopes([path]).proofs).toBe(false);
  }
  expect(ciScopes(["terraform/main.tf"]).terraform).toBe(true);
  for (const path of [
    "scripts/deploy/deployStaging.sh",
    "scripts/deploy/deployProduction.sh",
    "packages/api/scripts/deployApi.sh",
    "packages/api/wrangler.jsonc",
    "packages/app-web/scripts/deployAppWeb.sh",
    "packages/app-web/wrangler.app.jsonc",
  ]) {
    expect(ciScopes([path]).terraform).toBe(true);
  }
  for (const path of [
    ".github/workflows/ci.yml",
    ".mise.toml",
    "mise.lock",
    "bun.lock",
    "scripts/checks/ciPolicy.ts",
  ]) {
    expect(ciScopes([path])).toEqual({
      native: true,
      proofs: true,
      terraform: true,
    });
  }
});

test("each long suite runs in exactly one CI job", async () => {
  const root = `${import.meta.dir}/../../..`;
  const ci = Bun.YAML.parse(
    await Bun.file(`${root}/.github/workflows/ci.yml`).text(),
  ) as {
    jobs: Record<
      string,
      {
        steps?: { name?: string; run?: string }[];
        strategy?: { matrix?: { include?: { filter?: string }[] } };
      }
    >;
  };
  const { build, test: matrix } = ci.jobs;
  const suites = (matrix?.strategy?.matrix?.include ?? []).map(
    ({ filter }) => filter,
  );
  const run = build?.steps?.find(({ name }) => name === "Run tests")?.run;
  const excluded = [...(run ?? "").matchAll(/--filter='!([^']+)'/g)].map(
    ([, name]) => name,
  );
  expect(suites.length).toBeGreaterThan(0);
  expect(excluded.toSorted()).toEqual(suites.toSorted());
});

test("the required gate always evaluates all jobs and platform workflows are callable", async () => {
  const root = `${import.meta.dir}/../../..`;
  const ci = Bun.YAML.parse(
    await Bun.file(`${root}/.github/workflows/ci.yml`).text(),
  ) as {
    on: Record<string, unknown>;
    jobs: Record<string, { if?: string; needs?: string[]; uses?: string }>;
  };
  expect(ci.on).toHaveProperty("pull_request");
  const { gate, build, test: suites, windows } = ci.jobs;
  expect(gate?.if).toBe("always()");
  expect(gate?.needs?.toSorted()).toEqual(Object.keys(successful()).toSorted());
  expect(build?.if).toBeUndefined();
  expect(suites?.if).toBeUndefined();
  expect(windows?.if).toBeUndefined();
  for (const job of ["windows", "native"]) {
    const path = ci.jobs[job]?.uses;
    expect(path).toBeDefined();
    const platform = Bun.YAML.parse(
      await Bun.file(`${root}/${path}`).text(),
    ) as {
      on: Record<string, unknown>;
    };
    expect(platform.on).toHaveProperty("workflow_call");
  }
});

test("Lint checks a pull request's branch name without interpolating it", async () => {
  const root = `${import.meta.dir}/../../..`;
  const ci = Bun.YAML.parse(
    await Bun.file(`${root}/.github/workflows/ci.yml`).text(),
  ) as {
    jobs: Record<
      string,
      {
        steps?: {
          name?: string;
          if?: string;
          env?: Record<string, string>;
          run?: string;
        }[];
      }
    >;
  };
  const { lint } = ci.jobs;
  const steps = lint?.steps ?? [];
  const names = steps.map(({ name }) => name);
  const check = steps.find(({ name }) => name === "Check branch name");
  const { BRANCH_NAME: branchName } = check?.env ?? {};
  expect(check?.if).toBe("github.event_name == 'pull_request'");
  expect(branchName).toMatch(/^\$\{\{ github\.head_ref \}\}$/);
  expect(check?.run).toContain('"$GITHUB_SHA" "$BRANCH_NAME" 0 |');
  expect(check?.run).toContain("bun run agent-tool branch check --pre-push");
  if (!check?.run) throw new Error("missing CI branch check");
  for (const name of ["feat/valid", "--", "--pre-push", "--help"]) {
    const result = Bun.spawnSync(["sh", "-c", check.run], {
      cwd: repoRoot,
      env: { ...process.env, GITHUB_SHA: "a".repeat(40), BRANCH_NAME: name },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, name).toBe(name === "feat/valid" ? 0 : 1);
    expect(JSON.parse(result.stdout.toString()).branches[0].name).toBe(name);
  }
  const position = names.indexOf("Check branch name");
  expect(position).toBeGreaterThan(names.indexOf("Install dependencies"));
  expect(position).toBeLessThan(names.indexOf("Run lint checks"));
  for (const job of Object.values(ci.jobs)) {
    for (const { run } of job.steps ?? []) {
      expect(run ?? "").not.toContain("github.head_ref");
    }
  }
});
