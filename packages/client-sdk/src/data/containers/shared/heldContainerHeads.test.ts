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
import {
  createExecSql,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
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

test("locked executors share the canonical connection's held evidence", async () => {
  const execSql = executor();
  const base = await seed;
  await runSerializedSqlMutation(execSql, async (locked) => {
    remember(locked, [head(base, "locked")]);
    expect([
      ...heldContainerSnapshot(execSql, "cache-org").heads.keys(),
    ]).toEqual(["locked"]);
    remember(execSql, [head(base, "canonical")]);
    expect([
      ...heldContainerSnapshot(locked, "cache-org").heads.keys(),
    ]).toEqual(["locked", "canonical"]);
  });
});

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
  const snapshotHead = snapshot.heads.get("current");
  if (!snapshotHead) throw new Error("Expected snapshot head");
  snapshotHead.state.directGrants = latest.state.directGrants;
  expect(
    heldContainerSnapshot(execSql, "cache-org").heads.get("current")?.state
      .directGrants,
  ).toEqual([]);
  expect([...heldContainerSnapshot(execSql, "other-org").heads.keys()]).toEqual(
    ["foreign"],
  );
  expect(heldContainerSnapshot(executor(), "cache-org").heads.size).toBe(0);
  expect(() => remember(execSql, [head(base, "bad", 1, "other-org")])).toThrow(
    "another organization",
  );
});

test("a mixed-organization observation rejects the whole batch without caching a prefix", async () => {
  const execSql = executor();
  const base = await seed;
  remember(execSql, [head(base, "existing")]);
  expect(() =>
    remember(execSql, [
      head(base, "new"),
      head(base, "foreign", 1, "other-org"),
    ]),
  ).toThrow("another organization");
  expect([...heldContainerSnapshot(execSql, "cache-org").heads.keys()]).toEqual(
    ["existing"],
  );
  expect(heldContainerSnapshot(execSql, "other-org").heads.size).toBe(0);
});

test("a foreign organization policy rejects the whole observation before caching heads", async () => {
  const execSql = executor();
  const base = await seed;
  const policy = createPrincipalPolicyFixture({
    principalType: "group",
    principalId: "foreign-org",
    version: 1,
    keyEpoch: 1,
    stateHash: "foreign-policy",
    keyFingerprint: "key",
  });
  expect(() =>
    rememberVerifiedContainerHeads({
      execSql,
      organizationId: "cache-org",
      heads: [head(base, "new")],
      policies: [
        {
          ...policy,
          principalType: "organization",
          state: { ...policy.state, principalType: "organization" },
          checkpoint: { ...policy.checkpoint, principalType: "organization" },
        },
      ],
    }),
  ).toThrow("another organization");
  expect(heldContainerSnapshot(execSql, "cache-org").heads.size).toBe(0);
  expect(heldContainerSnapshot(execSql, "cache-org").policies).toEqual([]);
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

test("held policies isolate both the observed input and returned snapshots", () => {
  const execSql = executor();
  const policy = createPrincipalPolicyFixture({
    principalType: "group",
    principalId: "isolated",
    version: 1,
    keyEpoch: 1,
    stateHash: "policy:isolated:1",
    keyFingerprint: "key",
  });
  const expected = structuredClone(policy);
  rememberVerifiedContainerHeads({
    execSql,
    organizationId: "cache-org",
    heads: [],
    policies: [policy],
  });
  Reflect.set(policy, "stateHash", "mutated-input");
  const first = heldContainerSnapshot(execSql, "cache-org").policies;
  expect(first).toEqual([expected]);
  const returned = first[0];
  if (!returned) throw new Error("Expected held policy");
  Reflect.set(returned, "stateHash", "mutated-snapshot");
  expect(heldContainerSnapshot(execSql, "cache-org").policies).toEqual([
    expected,
  ]);
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

test("an optional cache-fill failure cannot reject completed checkpoint finalization", async () => {
  const execSql = executor();
  const context = createProjectionCheckpointContext({
    execSql,
    organizationId: "cache-org",
  });
  context.heldContainerHeads.push(head(await seed, "foreign", 1, "other-org"));
  await expect(
    finalizeProjectionCheckpoints(context, {}),
  ).resolves.toBeUndefined();
  expect(heldContainerSnapshot(execSql, "cache-org").heads.size).toBe(0);
});
