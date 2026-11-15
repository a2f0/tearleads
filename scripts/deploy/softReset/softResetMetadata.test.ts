import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";
import { metadataDrift } from "./softResetDrift.testUtils";
import { object } from "./softResetPlans";

const phases = [
  "postgres-no-op",
  "postgres-delete",
  "postgres-create",
  "postgres-no-op-recreated",
];

test.each([
  ["prod", false],
  ["staging", false],
  ["prod", true],
  ["staging", true],
] as const)(
  "%s metadata-only observations (schemaOnly=%j) survive every inspected plan and fresh verification",
  (tier, schemaOnly) => {
    const f = fixture(tier);
    try {
      const branch = metadataDrift("main_protection", tier);
      if (schemaOnly) {
        branch.change.after = structuredClone(branch.change.before);
        Object.assign(object(branch.change.after.api_data), {
          stale_schema: "true",
        });
        branch.change.after.api_response = JSON.stringify({
          ...JSON.parse(String(branch.change.before.api_response)),
          stale_schema: true,
        });
      }
      const drift = schemaOnly
        ? [branch]
        : [metadataDrift("database", tier), branch];
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
        "drift-postgres",
        "plan-destroy-postgres",
        "create-postgres",
        "verify-fresh",
      ])
        expect(record.steps).toContainEqual(
          expect.objectContaining({ label, status: "succeeded" }),
        );
      const plans = readFileSync(join(f.root, "drift-plans.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((plan) => plan.phase.startsWith("postgres-"));
      expect(plans.map((plan) => plan.phase)).toEqual(phases);
      for (const plan of plans) expect(plan.drift).toEqual(drift);
      expect(
        plans[0].actions.map((change: { actions: string[] }) => change.actions),
      ).toEqual(Array.from({ length: 5 }, () => ["no-op"]));
      expect(f.calls().filter((call) => call[2] === "apply")).toHaveLength(4);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);

test.each([
  ["postgres-no-op", "drift-postgres", "database", "api_response", 0],
  [
    "postgres-delete",
    "plan-destroy-postgres",
    "main_protection",
    "api_data",
    0,
  ],
  ["postgres-create", "create-postgres", "database", "api_data", 2],
  [
    "postgres-no-op-recreated",
    "verify-fresh",
    "main_protection",
    "api_response",
    4,
  ],
] as const)(
  "%s refuses real observation drift before the next effect",
  (phase, label, name, representation, applied) => {
    const f = fixture();
    try {
      const drift = metadataDrift(name);
      if (representation === "api_data")
        Object.assign(object(drift.change.after[representation]), {
          deletion_protected: "false",
        });
      else {
        const response = JSON.parse(String(drift.change.after[representation]));
        response.deletion_protected = false;
        drift.change.after[representation] = JSON.stringify(response);
      }
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
      expect(record.steps.at(-1)).toMatchObject({ label, status: "failed" });
      expect(f.calls().filter((call) => call[2] === "apply")).toHaveLength(
        applied,
      );
      expect(f.calls().some((call) => call[0] === "deployApi.sh")).toBe(false);
      if (applied === 0)
        expect(
          f.calls().some((call) => call[0] === "deployApiMaintenance.sh"),
        ).toBe(false);
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

test.each([
  [
    "bad-plan",
    "plan-destroy-postgres",
    "Plan actions/resource scope mismatch.",
  ],
  ["wrong-create", "create-postgres", "Plan identity mismatch"],
] as const)(
  "%s remains forbidden alongside harmless metadata drift",
  (fault, label, diagnostic) => {
    const f = fixture();
    try {
      writeFileSync(join(f.root, fault), "");
      writeFileSync(
        join(f.root, "plan-drift.json"),
        JSON.stringify(
          Object.fromEntries(
            phases.map((phase) => [phase, [metadataDrift("database")]]),
          ),
        ),
      );
      const result = f.run();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(diagnostic);
      expect(f.records().record.steps.at(-1)).toMatchObject({
        label,
        status: "failed",
      });
      expect(f.calls().some((call) => call[0] === "deployApi.sh")).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);
