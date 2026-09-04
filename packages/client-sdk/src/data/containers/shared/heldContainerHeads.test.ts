import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import {
  createContainerManifestFixture,
  createPrincipalPolicyFixture,
} from "@tearleads/crypto/test-fixtures";
import {
  createProjectionCheckpointContext,
  finalizeProjectionCheckpoints,
} from "../../keyingProjectionVerification/checkpointContext";
import { createExecSql } from "../../sqlite/sqlSchema";
import {
  heldContainerPath,
  heldContainerSnapshot,
  rememberVerifiedContainerHeads,
} from "./heldContainerHeads";

const seed = createContainerManifestFixture({
  containerId: "seed",
  directGrants: [],
  organizationId: "cache-org",
});
const executor = () => createExecSql({ exec: async () => ({ rows: [] }) });

// Isolated cache/graph tests model the already-verified caller boundary. These
// structural variants are never passed to cryptographic authorization.
function head(
  base: VerifiedContainerAccessManifest,
  id: string,
  epoch = 1,
  organizationId = "cache-org",
) {
  return {
    ...base,
    manifestHash: `hash:${organizationId}:${id}:${epoch}`,
    state: {
      ...base.state,
      containerId: id,
      epoch,
      organizationId,
    },
  };
}

function remember(
  execSql: ReturnType<typeof executor>,
  heads: readonly VerifiedContainerAccessManifest[],
  organizationId = "cache-org",
) {
  rememberVerifiedContainerHeads({
    execSql,
    organizationId,
    heads,
    policies: [],
  });
}

test("the held-head cache is bounded and re-observation refreshes eviction order", async () => {
  const execSql = executor();
  const base = await seed;
  const heads = Array.from({ length: 256 }, (_, i) => head(base, String(i)));
  remember(execSql, heads);
  remember(execSql, [head(base, "0")]);
  remember(execSql, [head(base, "256")]);
  const snapshot = heldContainerSnapshot(execSql, "cache-org");
  expect(snapshot.heads.size).toBe(256);
  expect(snapshot.heads.has("0")).toBe(true);
  expect(snapshot.heads.has("1")).toBe(false);
  expect(snapshot.heads.has("256")).toBe(true);
});

test("held heads are copied, organization-scoped, and never replaced by older or conflicting epochs", async () => {
  const execSql = executor();
  const base = await seed;
  const latest = head(base, "current", 2);
  remember(execSql, [latest]);
  latest.state.directGrants = [
    { subjectType: "user", subjectId: "injected", accessLevel: "admin" },
  ];
  remember(execSql, [
    head(base, "current", 1),
    { ...head(base, "current", 2), manifestHash: "fork" },
  ]);
  remember(execSql, [head(base, "foreign", 1, "other-org")], "other-org");
  const snapshot = heldContainerSnapshot(execSql, "cache-org");
  expect([...snapshot.heads.keys()]).toEqual(["current"]);
  expect(snapshot.heads.get("current")?.state.directGrants).toEqual([]);
  expect(snapshot.heads.get("current")?.bundle.manifestHash).toBe(
    "hash:cache-org:current:2",
  );
  expect([...heldContainerSnapshot(execSql, "other-org").heads.keys()]).toEqual(
    ["foreign"],
  );
  expect(heldContainerSnapshot(executor(), "cache-org").heads.size).toBe(0);
  expect(() => remember(execSql, [head(base, "bad", 1, "other-org")])).toThrow(
    "another organization",
  );
});

test("held principal policies are bounded, organization-scoped, and monotonic", () => {
  const execSql = executor();
  const policy = (id: string, version = 1) =>
    createPrincipalPolicyFixture({
      principalType: "group",
      principalId: id,
      version,
      keyEpoch: 1,
      stateHash: `policy:${id}:${version}`,
      keyFingerprint: "key",
    });
  const store = (
    organizationId: string,
    policies: ReturnType<typeof policy>[],
  ) =>
    rememberVerifiedContainerHeads({
      execSql,
      organizationId,
      heads: [],
      policies,
    });
  store(
    "cache-org",
    Array.from({ length: 512 }, (_, i) => policy(String(i))),
  );
  store("cache-org", [policy("0")]);
  store("cache-org", [policy("512", 2), policy("512", 1)]);
  const policies = heldContainerSnapshot(execSql, "cache-org").policies;
  expect(policies).toHaveLength(512);
  expect(policies.some((item) => item.principalId === "0")).toBe(true);
  expect(policies.some((item) => item.principalId === "1")).toBe(false);
  expect(policies.find((item) => item.principalId === "512")?.version).toBe(2);
  store("other-org", [policy("512", 3)]);
  expect(heldContainerSnapshot(execSql, "other-org").policies).toEqual([
    policy("512", 3),
  ]);
  expect(
    heldContainerSnapshot(execSql, "cache-org").policies.find(
      (item) => item.principalId === "512",
    )?.version,
  ).toBe(2);
});

test("held path reconstruction rejects missing ancestors, cycles, and excess depth", async () => {
  const execSql = executor();
  const base = await seed;
  const heads = Array.from({ length: 101 }, (_, i) => {
    const value = head(base, String(i));
    return {
      ...value,
      state: {
        ...value.state,
        parentContainerId: i === 0 ? null : String(i - 1),
      },
    };
  });
  remember(execSql, heads);
  const snapshot = heldContainerSnapshot(execSql, "cache-org");
  expect(heldContainerPath(snapshot.heads, "99")).toHaveLength(100);
  expect(heldContainerPath(snapshot.heads, "100")).toBeNull();
  snapshot.heads.delete("0");
  expect(heldContainerPath(snapshot.heads, "1")).toBeNull();
  const parent = snapshot.heads.get("1");
  if (!parent) throw new Error("Expected structural parent");
  snapshot.heads.set("1", {
    ...parent,
    state: { ...parent.state, parentContainerId: "2" },
  });
  expect(heldContainerPath(snapshot.heads, "2")).toBeNull();
});

test("validate-only projection completion does not populate the held-head cache", async () => {
  const execSql = executor();
  const context = createProjectionCheckpointContext({
    execSql,
    organizationId: "cache-org",
  });
  context.heldContainerHeads.push(await seed);
  await finalizeProjectionCheckpoints(context, {
    persistVerificationCheckpoints: false,
  });
  expect(heldContainerSnapshot(execSql, "cache-org").heads.size).toBe(0);
});
