import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";

// Each end-to-end fixture starts hundreds of short real processes; 30 seconds
// bounds the entire reset, rather than applying Bun's unit-test 5s default.
test("first command failure retains failed-step/total timings and blocks a fresh run", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "fail"), "drop-postgres-owned.sh");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    const { dir, record } = f.records();
    expect(record.status).toBe("failed");
    expect(
      JSON.parse(readFileSync(join(dir, "identities-before.json"), "utf8"))
        .database.branch_id,
    ).toBe("old-branch");
    expect(record.steps.at(-1)).toMatchObject({
      label: "drop-owned",
      status: "failed",
    });
    expect(record.steps.at(-1).elapsedMs).toBeGreaterThan(0);
    expect(record.elapsedMs).toBeGreaterThan(0);
    expect(result.stdout.toString()).toContain("total\tfailed");
    expect(result.stderr.toString()).toContain("No rollback");
    expect(result.stderr.toString()).not.toContain("SECRET_CANARY");
    expect(existsSync(join(dir, "private/postgres-delete.tfplan"))).toBe(true);
    const calls = f.calls();
    expect(calls.some((call) => call[2] === "apply")).toBe(false);
    const repeated = f.run();
    expect(repeated.exitCode).toBe(1);
    expect(repeated.stderr.toString()).toContain("lock exists");
    expect(f.calls()).toEqual(calls);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("foreign override or cross-clone lock is not removed or reused", () => {
  for (const kind of ["override", "lock"]) {
    const f = fixture();
    try {
      const target =
        kind === "override"
          ? join(
              f.repo,
              "terraform/stacks/prod/storage/greenfield_reset_override.tf",
            )
          : join(
              f.home,
              ".local/state/tearleads-soft-reset/prod.lock/owner.json",
            );
      mkdirSync(join(target, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(target, "foreign owner");
      const result = f.run();
      expect(result.exitCode).toBe(1);
      expect(readFileSync(target, "utf8")).toBe("foreign owner");
      expect(existsSync(join(f.root, "calls.jsonl"))).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
}, 30_000);

test("unexpected resource identities and destroy-plan scope stop before maintenance", () => {
  for (const fault of [
    "wrong-database",
    "wrong-account",
    "bad-plan",
    "drift",
  ]) {
    const f = fixture();
    try {
      writeFileSync(join(f.root, fault), "");
      const result = f.run();
      expect(result.exitCode).toBe(1);
      expect(
        f
          .calls()
          .some(
            (call) =>
              call[0] === "deployApiMaintenance.sh" || call[2] === "apply",
          ),
      ).toBe(false);
      expect(
        existsSync(
          join(f.repo, "terraform/stacks/prod/postgres/soft_reset_override.tf"),
        ),
      ).toBe(false);
      expect(f.records().record.status).toBe("failed");
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
}, 30_000);

test("plan bytes cannot change while Terraform renders the inspected JSON", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "change-plan-during-show"), "");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    expect(
      f
        .calls()
        .some(
          (call) =>
            call[0] === "deployApiMaintenance.sh" || call[2] === "apply",
        ),
    ).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test.each([
  ["old-relations", "verify-dropped", "empty-r2-bucket.sh"],
  ["old-blobs", "empty-blobs", "deployApi.sh"],
  ["old-branch", "verify-fresh", "deployApi.sh"],
  ["wrong-schema", "verify-schema", "deployAppWeb.sh"],
])(
  "failed data verification %s stops at %s",
  (fault, label, forbidden) => {
    const f = fixture();
    try {
      writeFileSync(join(f.root, fault), "");
      const result = f.run();
      expect(result.exitCode).toBe(1);
      expect(f.records().record.steps.at(-1)).toMatchObject({
        label,
        status: "failed",
      });
      expect(f.calls().some((call) => call[0] === forbidden)).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);

test("unusable direct database access fails before maintenance", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "fail"), "psql");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    expect(
      f.calls().some((call) => call[0] === "deployApiMaintenance.sh"),
    ).toBe(false);
    expect(f.records().record.steps.at(-1).label).toBe("data-access");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("changed inventory after maintenance stops before drop-owned", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "changed-maintenance-inventory"), "");
    const result = f.run();
    expect(f.records().record.steps.at(-1)).toMatchObject({
      label: "recheck-identities",
      status: "failed",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "Live identities or credentials changed",
    );
    expect(existsSync(join(f.root, "maintenance-complete"))).toBe(true);
    expect(f.calls().some((call) => call[0] === "drop-postgres-owned.sh")).toBe(
      false,
    );
    expect(f.calls().some((call) => call[2] === "apply")).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("changed blob credentials immediately before empty-blobs block deletion", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "changed-blob-credentials"), "");
    const result = f.run();
    expect(f.records().record.steps.at(-1)).toMatchObject({
      label: "empty-blobs",
      status: "failed",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "Blob credentials/identity changed",
    );
    expect(existsSync(join(f.root, "postgres-destroyed"))).toBe(true);
    expect(f.calls().some((call) => call[0] === "empty-r2-bucket.sh")).toBe(
      false,
    );
    expect(existsSync(join(f.root, "storage-destroyed"))).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("changed inventory at verify-public refuses success and retains recovery state", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "changed-public-inventory"), "");
    const result = f.run();
    expect(f.records().record.steps.at(-1)).toMatchObject({
      label: "verify-public",
      status: "failed",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "Live identities or credentials changed",
    );
    expect(existsSync(join(f.root, "website-deployed"))).toBe(true);
    expect(f.calls().filter((call) => call[0] === "curl")).toHaveLength(4);
    expect(existsSync(join(f.records().dir, "private"))).toBe(true);
    expect(
      existsSync(join(f.home, ".local/state/tearleads-soft-reset/prod.lock")),
    ).toBe(true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("migration output must bind to the inspected role before downtime", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "unbound-migration"), "");
    const result = f.run();
    expect(f.records().record.steps.at(-1)).toMatchObject({
      label: "drift-postgres",
      status: "failed",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "not bound to the inspected role",
    );
    expect(
      f.calls().some((call) => call[0] === "deployApiMaintenance.sh"),
    ).toBe(false);
    expect(f.calls().some((call) => call[2] === "apply")).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("Terraform unknown identity must not excuse a known wrong create target", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "wrong-create"), "");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    expect(f.records().record.steps.at(-1)).toMatchObject({
      label: "create-postgres",
      status: "failed",
    });
    expect(
      f
        .calls()
        .filter(
          (call) => call[0] === "run-postgres-stack.sh" && call[2] === "apply",
        ),
    ).toHaveLength(1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);
