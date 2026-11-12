import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";

const command = join(import.meta.dir, "softReset.ts");

test("authorized reset completes only the application sequence with private timings", () => {
  const f = fixture();
  try {
    const result = f.run();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("succeeded");
    const { dir, record } = f.records();
    expect(record.status).toBe("succeeded");
    expect(record.steps.map((step: { label: string }) => step.label)).toEqual([
      "credentials",
      "inventory",
      "drift-postgres",
      "drift-storage",
      "data-access",
      "plan-destroy-postgres",
      "plan-destroy-storage",
      "runtime-build",
      "devkit-config",
      "website-readiness",
      "web-readiness",
      "api-readiness",
      "maintenance",
      "recheck-identities",
      "drop-owned",
      "verify-dropped",
      "destroy-postgres",
      "empty-blobs",
      "destroy-storage",
      "create-postgres",
      "create-storage",
      "verify-fresh",
      "deploy-api",
      "verify-api",
      "verify-schema",
      "deploy-app-demo",
      "deploy-website",
      "verify-public",
      "cleanup",
    ]);
    expect(
      record.steps.every(
        (step: { status: string; elapsedMs: number }) =>
          step.status === "succeeded" && step.elapsedMs >= 0,
      ),
    ).toBe(true);
    expect(record.elapsedMs).toBeGreaterThan(0);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "timings.json")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dir, "private"))).toBe(false);
    expect(
      existsSync(join(f.home, ".local/state/tearleads-soft-reset/prod.lock")),
    ).toBe(false);
    const calls = f.calls();
    expect(
      calls.filter((call) =>
        call.some((arg) => /app-(capacitor|electrobun)/.test(arg)),
      ),
    ).toEqual([
      ["bun", "run", "--cwd", "packages/app-electrobun", "prepare:devkit"],
    ]);
    expect(
      calls.filter((call) => /^(deploy|drop|empty|verify)/.test(call[0] ?? "")),
    ).toEqual([
      ["deployApiMaintenance.sh", "prod"],
      ["drop-postgres-owned.sh", "prod"],
      ["empty-r2-bucket.sh", "prod", "storage"],
      ["deployApi.sh", "prod"],
      ["verifyApi.sh", "prod"],
      ["deployAppWeb.sh", "prod"],
      ["deployWebsite.sh", "prod", "--skip-terraform"],
    ]);
    expect(JSON.stringify(calls)).not.toMatch(
      /destroyTier|destroyProduction|destroy-stack|prepare-postgres|prepare-storage|release:|build:ios|build:android|build:desktop/,
    );
    expect(
      calls
        .filter((call) => /run-(edge|website)-stack/.test(call[0] ?? ""))
        .every((call) => call[2] === "output"),
    ).toBe(true);
    expect(result.stdout.toString() + result.stderr.toString()).not.toContain(
      "SECRET_CANARY",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("staging is explicitly tiered through every deployment and database probe", () => {
  const f = fixture("staging");
  try {
    const result = f.run();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(f.records().record.tier).toBe("staging");
    expect(
      f
        .calls()
        .filter((call) => call[0]?.endsWith(".sh"))
        .every((call) => call[1] === "staging"),
    ).toBe(true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("AWS probes remove inherited profiles and session tokens rather than blanking them", () => {
  const f = fixture();
  try {
    Object.assign(f.env, {
      AWS_PROFILE: "misleading-profile",
      AWS_DEFAULT_PROFILE: "misleading-default",
      AWS_SESSION_TOKEN: "misleading-session",
      AWS_SECURITY_TOKEN: "misleading-security",
    });
    const result = f.run();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(f.calls().filter((call) => call[0] === "aws")).toHaveLength(6);
    expect(f.records().record.status).toBe("succeeded");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("teardown authorization reaches only the three destructive helpers", () => {
  const f = fixture();
  try {
    Object.assign(f.env, { TEARLEADS_TEARDOWN_TIER: "staging" });
    const result = f.run();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const environments = readFileSync(
      join(f.root, "teardown-tier.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { tool: string; tier: string | null });
    expect(environments.filter(({ tier }) => tier !== null)).toEqual([
      { tool: "deployApiMaintenance.sh", tier: "prod" },
      { tool: "drop-postgres-owned.sh", tier: "prod" },
      { tool: "empty-r2-bucket.sh", tier: "prod" },
    ]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("default preview and help cannot invoke credentials or providers", () => {
  for (const args of [[], ["--help"], ["prod"], ["staging", "--preview"]]) {
    const result = Bun.spawnSync([process.execPath, command, ...args], {
      env: { PATH: "/nonexistent", HOME: "/nonexistent" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("PREVIEW");
    expect(result.stdout.toString()).toContain("930");
    expect(result.stdout.toString()).toContain("No native");
    expect(result.stderr.toString()).toBe("");
  }
});

test("apply requires an explicit tier and exact destructive confirmation", () => {
  for (const args of [
    ["--apply"],
    ["production", "--apply"],
    ["prod", "--apply"],
    ["prod", "--apply", "--confirm", "RESET staging APPLICATION DATA"],
    ["prod", "--apply", "--preview"],
    ["prod", "--unknown"],
  ]) {
    const result = Bun.spawnSync([process.execPath, command, ...args], {
      env: { PATH: "/nonexistent", HOME: "/nonexistent" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("authorization");
  }
});
