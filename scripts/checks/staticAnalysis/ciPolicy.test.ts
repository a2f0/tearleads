import { expect, test } from "bun:test";
import { assertCiSuccess, ciDiffRange, ciScopes } from "../ciPolicy";

const successful = () => ({
  changes: {
    result: "success",
    outputs: { native: "false", terraform: "false" },
  },
  lint: { result: "success" },
  build: { result: "success" },
  "postgres-concurrency": { result: "success" },
  windows: { result: "success" },
  native: { result: "skipped" },
  terraform: { result: "skipped" },
});

test("required native and Terraform jobs must succeed, never skip", () => {
  for (const job of ["native", "terraform"]) {
    const needs = successful();
    needs.changes.outputs = { ...needs.changes.outputs, [job]: "true" };
    expect(() => assertCiSuccess(needs)).toThrow(`${job} must be success`);
    expect(() =>
      assertCiSuccess({
        ...needs,
        [job]: { result: "success" },
      }),
    ).not.toThrow();
    for (const result of ["failure", "cancelled", "pending"]) {
      expect(() => assertCiSuccess({ ...needs, [job]: { result } })).toThrow();
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
      ).toThrow();
    }
  }
  for (const job of [
    "changes",
    "lint",
    "build",
    "postgres-concurrency",
    "windows",
  ]) {
    expect(() =>
      assertCiSuccess({ ...successful(), [job]: { result: "skipped" } }),
    ).toThrow();
  }
  expect(() => assertCiSuccess({})).toThrow();
  expect(() =>
    assertCiSuccess({ ...successful(), changes: { result: "success" } }),
  ).toThrow();
});

test("selects native and infrastructure checks without skipping their dependencies", () => {
  expect(ciScopes(["docs/example.md"])).toEqual({
    native: false,
    terraform: false,
  });
  expect(ciScopes(["packages/app-capacitor/ios/App/App.swift"]).native).toBe(
    true,
  );
  expect(ciScopes(["terraform/main.tf"]).terraform).toBe(true);
  for (const path of [
    "scripts/deployStaging.sh",
    "scripts/deployProduction.sh",
    "packages/api/scripts/deployProductionApi.sh",
    "packages/app-web/scripts/deployAppWeb.sh",
  ]) {
    expect(ciScopes([path]).terraform).toBe(true);
  }
  for (const path of [
    ".github/workflows/ci.yml",
    "bun.lock",
    "scripts/checks/ciPolicy.ts",
  ]) {
    expect(ciScopes([path])).toEqual({
      native: true,
      terraform: true,
    });
  }
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
  const { gate, build, windows } = ci.jobs;
  expect(gate?.if).toBe("always()");
  expect(gate?.needs?.toSorted()).toEqual(Object.keys(successful()).toSorted());
  expect(build?.if).toBeUndefined();
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
