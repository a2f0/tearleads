import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";
import { bucketLocationDrift } from "./softResetDrift.testUtils";

const phases = ["storage-no-op", "storage-delete", "storage-create"];

function benignDrift(f: ReturnType<typeof fixture>) {
  writeFileSync(
    join(f.root, "plan-drift.json"),
    JSON.stringify(
      Object.fromEntries(
        phases.map((phase) => [phase, [bucketLocationDrift()]]),
      ),
    ),
  );
}

test.each([
  [
    "variables",
    ["variables", "cloudflare_account_id", "value"],
    "b".repeat(32),
    "Unexpected plan variables.",
  ],
  [
    "address",
    ["resource_changes", 0, "address"],
    "cloudflare_r2_bucket.downloads",
    "Plan actions/resource scope mismatch.",
  ],
  [
    "action",
    ["resource_changes", 0, "change", "actions"],
    ["update"],
    "Plan actions/resource scope mismatch.",
  ],
  [
    "account",
    ["resource_changes", 0, "change", "before", "account_id"],
    "b".repeat(32),
    "Plan identity mismatch",
  ],
  [
    "bucket",
    ["resource_changes", 0, "change", "before", "name"],
    "tearleads-blobs-other",
    "Plan identity mismatch",
  ],
  [
    "token",
    ["resource_changes", 4, "change", "before", "policies", 0, "resources"],
    JSON.stringify({ "com.cloudflare.edge.r2.bucket.foreign": "*" }),
    "Unexpected blob token scope.",
  ],
])(
  "storage plan %s guard remains mandatory alongside benign drift",
  (_name, path, value, diagnostic) => {
    const f = fixture();
    try {
      benignDrift(f);
      writeFileSync(
        join(f.root, "plan-mutation.json"),
        JSON.stringify({ file: "storage-delete.tfplan", path, value }),
      );
      const result = f.run();
      expect(result.exitCode, result.stderr.toString()).toBe(1);
      expect(result.stderr.toString()).toContain(String(diagnostic));
      expect(f.records().record.steps).toContainEqual(
        expect.objectContaining({
          label: "plan-destroy-postgres",
          status: "succeeded",
        }),
      );
      expect(f.records().record.steps.at(-1)).toMatchObject({
        label: "plan-destroy-storage",
        status: "failed",
      });
      expect(existsSync(join(f.root, "maintenance-complete"))).toBe(false);
      expect(f.calls().some((call) => call[2] === "apply")).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);

test.each([
  ["during", "drift-storage", "Saved plan changed during inspection."],
  ["after", "destroy-storage", "Saved plan changed after inspection."],
])(
  "storage saved bytes remain bound %s inspection alongside benign drift",
  (when, label, diagnostic) => {
    const f = fixture();
    try {
      benignDrift(f);
      writeFileSync(join(f.root, `change-storage-plan-${when}-show`), "");
      const result = f.run();
      expect(result.exitCode, result.stderr.toString()).toBe(1);
      expect(result.stderr.toString()).toContain(String(diagnostic));
      expect(f.records().record.steps.at(-1)).toMatchObject({
        label,
        status: "failed",
      });
      expect(existsSync(join(f.root, "maintenance-complete"))).toBe(
        when === "after",
      );
      expect(existsSync(join(f.root, "postgres-destroyed"))).toBe(
        when === "after",
      );
      expect(existsSync(join(f.root, "storage-destroyed"))).toBe(false);
      expect(f.calls().some((call) => call[0] === "deployApi.sh")).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);

test.each([
  ["storage-no-op", "drift-storage", "drift-postgres", "location", "WNAM"],
  [
    "storage-delete",
    "plan-destroy-storage",
    "plan-destroy-postgres",
    "id",
    "foreign-id",
  ],
  [
    "storage-create",
    "create-storage",
    "create-postgres",
    "policy",
    { allow: false },
  ],
  // The existing post-recreation plan is PostgreSQL: bucket drift must not
  // acquire the storage exception there, even when its location is harmless.
  [
    "postgres-no-op-recreated",
    "verify-fresh",
    "create-storage",
    "location",
    "ENAM",
  ],
] as const)(
  "%s refuses bucket drift before the next effect",
  (phase, label, completed, key, value) => {
    const f = fixture();
    try {
      const drift = bucketLocationDrift();
      drift.change.after[key] = value;
      writeFileSync(
        join(f.root, "plan-drift.json"),
        JSON.stringify({ [phase]: [drift] }),
      );
      const result = f.run();
      expect(result.exitCode, result.stderr.toString()).toBe(1);
      expect(result.stderr.toString()).toContain(
        "Terraform drift requires manual reconciliation.",
      );
      const { dir, record } = f.records();
      expect(record.steps).toContainEqual(
        expect.objectContaining({ label: completed, status: "succeeded" }),
      );
      expect(record.steps.at(-1)).toMatchObject({ label, status: "failed" });
      const recreated = phase === "postgres-no-op-recreated";
      const creating = phase === "storage-create";
      expect(existsSync(join(f.root, "maintenance-complete"))).toBe(
        creating || recreated,
      );
      expect(existsSync(join(f.root, "storage-destroyed"))).toBe(
        creating || recreated,
      );
      expect(existsSync(join(f.root, "postgres-created"))).toBe(
        creating || recreated,
      );
      expect(existsSync(join(f.root, "storage-created"))).toBe(recreated);
      expect(f.calls().some((call) => call[0] === "deployApi.sh")).toBe(false);
      expect(existsSync(join(dir, "private"))).toBe(true);
      expect(
        existsSync(join(f.home, ".local/state/tearleads-soft-reset/prod.lock")),
      ).toBe(true);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);

test.each(["prod", "staging"] as const)(
  "%s bucket location casing survives all inspected storage plans",
  (tier) => {
    const f = fixture(tier);
    try {
      const drift = [bucketLocationDrift(tier)];
      writeFileSync(
        join(f.root, "plan-drift.json"),
        JSON.stringify(
          Object.fromEntries(phases.map((phase) => [phase, drift])),
        ),
      );
      const result = f.run();
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const { record } = f.records();
      expect(record.status).toBe("succeeded");
      for (const label of [
        "drift-storage",
        "plan-destroy-storage",
        "create-storage",
        "verify-fresh",
      ])
        expect(record.steps).toContainEqual(
          expect.objectContaining({ label, status: "succeeded" }),
        );
      const plans = readFileSync(join(f.root, "drift-plans.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((plan) => plan.phase.startsWith("storage-"));
      expect(plans.map((plan) => plan.phase)).toEqual(phases);
      for (const plan of plans) expect(plan.drift).toEqual(drift);
      expect(
        plans.map((plan) =>
          plan.actions.map((change: { actions: string[] }) => change.actions),
        ),
      ).toEqual(
        ["no-op", "delete", "create"].map((action) =>
          Array.from({ length: 5 }, () => [action]),
        ),
      );
      // verify-fresh currently inspects PostgreSQL, not another storage plan.
      // Successful completion does not establish a post-recreation R2 drift check.
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);
