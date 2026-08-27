import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshots";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
  observePrincipalPolicy,
} from "./checkpointContext";
import {
  enforcePrincipalPolicySnapshotCheckpoints,
  verifyPrincipalPolicySnapshots,
} from "./principalPolicySnapshotVerification";

test("verifies a redacted policy through its signed external authority", async () => {
  const fixture = await createExternallyAuthorizedPrincipalPolicySnapshots();
  const verified = await verifyPrincipalPolicySnapshots({
    resolveUserKey: fixture.resolveUserKey,
    snapshots: [fixture.subject, fixture.admin],
  });
  expect(verified).toHaveLength(2);

  await expect(
    verifyPrincipalPolicySnapshots({
      resolveUserKey: fixture.resolveUserKey,
      snapshots: [fixture.subject],
    }),
  ).rejects.toThrow("Principal policy snapshot authority is missing");
});

test("rejects a tampered redacted policy projection", async () => {
  const fixture = await createExternallyAuthorizedPrincipalPolicySnapshots();
  await expect(
    verifyPrincipalPolicySnapshots({
      resolveUserKey: fixture.resolveUserKey,
      snapshots: [{ ...fixture.admin, currentProjection: [] }],
    }),
  ).rejects.toThrow("projection root does not match");
});

test("rejects a signed snapshot that conflicts with the durable policy pin", async () => {
  const fixture = await createExternallyAuthorizedPrincipalPolicySnapshots();
  const { close, execSql } = await createTestExecSql(
    "principal-policy-snapshot-verification",
  );
  try {
    const state = fixture.admin.currentState;
    await loadPrincipalPolicyCheckpoint(
      execSql,
      state.principalType,
      state.principalId,
    );
    await execSql(
      `INSERT INTO principal_policy_checkpoints
         (principal_type, principal_id, version, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        state.principalType,
        state.principalId,
        state.version,
        "f".repeat(64),
        "2026-08-27T00:00:00.000Z",
      ],
    );

    const policies = await verifyPrincipalPolicySnapshots({
      resolveUserKey: fixture.resolveUserKey,
      snapshots: [fixture.admin],
    });
    await expect(
      enforcePrincipalPolicySnapshotCheckpoints({ execSql, policies }),
    ).rejects.toMatchObject({ code: "equivocation" });
  } finally {
    close();
  }
});

test("atomically pins first-seen purge policy snapshots", async () => {
  const fixture = await createExternallyAuthorizedPrincipalPolicySnapshots();
  const policies = await verifyPrincipalPolicySnapshots({
    resolveUserKey: fixture.resolveUserKey,
    snapshots: [fixture.subject, fixture.admin],
  });
  const { close, execSql } = await createTestExecSql(
    "principal-policy-snapshot-first-pin",
  );
  try {
    const context = createProjectionCheckpointContext({ execSql });
    for (const policy of policies) observePrincipalPolicy(context, policy);
    await commitProjectionCheckpoints(context);

    for (const policy of policies) {
      await expect(
        loadPrincipalPolicyCheckpoint(
          execSql,
          policy.principalType,
          policy.principalId,
        ),
      ).resolves.toMatchObject({
        stateHash: policy.stateHash,
        version: policy.version,
      });
    }
  } finally {
    close();
  }
});

test("atomic purge policy pinning rejects a checkpoint race", async () => {
  const fixture = await createExternallyAuthorizedPrincipalPolicySnapshots();
  const policies = await verifyPrincipalPolicySnapshots({
    resolveUserKey: fixture.resolveUserKey,
    snapshots: [fixture.subject, fixture.admin],
  });
  const { close, execSql } = await createTestExecSql(
    "principal-policy-snapshot-race",
  );
  try {
    const context = createProjectionCheckpointContext({ execSql });
    for (const policy of policies) observePrincipalPolicy(context, policy);
    const raced = policies[0];
    if (!raced) throw new Error("Expected a policy snapshot");
    await loadPrincipalPolicyCheckpoint(
      execSql,
      raced.principalType,
      raced.principalId,
    );
    await execSql(
      `INSERT INTO principal_policy_checkpoints
         (principal_type, principal_id, version, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        raced.principalType,
        raced.principalId,
        raced.version,
        "e".repeat(64),
        "2026-08-27T00:00:00.000Z",
      ],
    );

    await expect(commitProjectionCheckpoints(context)).rejects.toMatchObject({
      code: "equivocation",
    });
    const untouched = policies[1];
    if (!untouched) throw new Error("Expected an atomic policy batch");
    await expect(
      loadPrincipalPolicyCheckpoint(
        execSql,
        untouched.principalType,
        untouched.principalId,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
