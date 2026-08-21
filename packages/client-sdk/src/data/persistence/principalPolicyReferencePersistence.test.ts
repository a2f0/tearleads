import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
  referencedPrincipalStateFromPolicyState,
} from "../../../test/helpers/policyCacheFixtures";
import { savePrincipalPolicyBundle } from "./principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "./principalPolicyReferencePersistence";

test("exact principal policy lookup loads a current head", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-current",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(
        execSql,
        referencedPrincipalStateFromBundle(bundle),
        null,
      ),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("exact principal policy lookup uses the newest current chain containing a historical head", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-current-history",
  );
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("Expected a predecessor state");
    }
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(
        execSql,
        referencedPrincipalStateFromPolicyState(previousState),
        null,
      ),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("exact principal policy lookup loads a retained bundle when current is absent", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-retained",
  );
  try {
    const { bundle: retainedBundle } = await createPrincipalPolicyBundle();
    const { bundle: successorBundle } =
      await createSuccessorPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      retainedBundle,
      "2026-07-18T00:00:00Z",
    );
    await savePrincipalPolicyBundle(
      execSql,
      successorBundle,
      "2026-07-18T00:01:00Z",
    );
    await execSql(
      "DELETE FROM principal_policies WHERE principal_type = ? AND principal_id = ?",
      [
        retainedBundle.currentState.principalType,
        retainedBundle.currentState.principalId,
      ],
    );

    await expect(
      loadPrincipalPolicyBundleForReference(
        execSql,
        referencedPrincipalStateFromBundle(retainedBundle),
        null,
      ),
    ).resolves.toEqual(retainedBundle);
  } finally {
    close();
  }
});

test("exact principal policy lookup returns null for an honest miss", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-miss",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(
        execSql,
        {
          ...reference,
          version: reference.version + 1,
          stateHash: "0".repeat(64),
        },
        null,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("exact principal policy lookup rejects a same-version current conflict", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-corrupt",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(
        execSql,
        {
          ...reference,
          stateHash: "0".repeat(64),
        },
        null,
      ),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
  } finally {
    close();
  }
});

test("exact principal policy lookup ignores a corrupt unrelated retained row", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-unrelated-corrupt",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");
    await execSql(
      `INSERT INTO principal_policy_bundle_history
         (principal_type, principal_id, state_hash, current_state_json,
          current_payload_json, current_projection_json,
          current_member_envelopes_json, current_grants_json,
          previous_states_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference.principalType,
        reference.principalId,
        "e".repeat(64),
        "{",
        "{",
        "{",
        "{",
        "{",
        "{",
        "2026-07-18T00:01:00Z",
      ],
    );

    await expect(
      loadPrincipalPolicyBundleForReference(execSql, reference, null),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("exact principal policy lookup hard-fails for a corrupt indexed retained row", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-indexed-corrupt",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");
    await execSql(
      `INSERT INTO principal_policy_bundle_history
       SELECT * FROM principal_policies
       WHERE principal_type = ? AND principal_id = ?`,
      [reference.principalType, reference.principalId],
    );
    await execSql(
      `DELETE FROM principal_policies
       WHERE principal_type = ? AND principal_id = ?`,
      [reference.principalType, reference.principalId],
    );
    await execSql(
      `UPDATE principal_policy_bundle_history
       SET current_state_json = ?
       WHERE principal_type = ? AND principal_id = ? AND state_hash = ?`,
      [
        "{",
        reference.principalType,
        reference.principalId,
        reference.stateHash,
      ],
    );

    await expect(
      loadPrincipalPolicyBundleForReference(execSql, reference, null),
    ).rejects.toMatchObject({
      code: "invalid_shape",
      name: "KeyingVerificationError",
    });
  } finally {
    close();
  }
});

test("exact principal policy lookup treats a head behind its checkpoint as a miss", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-behind-checkpoint",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const { bundle: successorBundle } =
      await createSuccessorPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(execSql, reference, {
        principalType: reference.principalType,
        principalId: reference.principalId,
        version: successorBundle.currentState.version,
        stateHash: successorBundle.currentState.stateHash,
      }),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("exact principal policy lookup hard-fails on a same-version checkpoint conflict", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-checkpoint-conflict",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(execSql, reference, {
        principalType: reference.principalType,
        principalId: reference.principalId,
        version: reference.version,
        stateHash: "f".repeat(64),
      }),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
  } finally {
    close();
  }
});

test("exact principal policy lookup hard-fails on same-version indexed candidates", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-index-conflict",
  );
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("Expected a predecessor state");
    }
    const reference = referencedPrincipalStateFromPolicyState(previousState);
    const competingStateHash = "f".repeat(64);
    const newerStateHash = "e".repeat(64);
    const newerBundle = {
      ...bundle,
      currentState: {
        ...bundle.currentState,
        version: bundle.currentState.version + 1,
        prevStateHash: bundle.currentState.stateHash,
        stateHash: newerStateHash,
      },
      currentPayload: { ...bundle.currentPayload, stateHash: newerStateHash },
      currentMemberEnvelopes: {
        ...bundle.currentMemberEnvelopes,
        stateHash: newerStateHash,
      },
      previousStates: [
        ...bundle.previousStates,
        {
          state: bundle.currentState,
          projection: bundle.currentProjection,
          grants: bundle.currentGrants,
        },
      ],
    };
    const competingCurrentState = {
      ...bundle.currentState,
      stateHash: competingStateHash,
    };
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");
    await savePrincipalPolicyBundle(
      execSql,
      newerBundle,
      "2026-07-18T00:00:30Z",
    );
    await execSql(
      `INSERT INTO principal_policy_bundle_history
         (principal_type, principal_id, state_hash, current_state_json,
          current_payload_json, current_projection_json,
          current_member_envelopes_json, current_grants_json,
          previous_states_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference.principalType,
        reference.principalId,
        competingStateHash,
        JSON.stringify(competingCurrentState),
        JSON.stringify(bundle.currentPayload),
        JSON.stringify(bundle.currentProjection),
        JSON.stringify(bundle.currentMemberEnvelopes),
        JSON.stringify(bundle.currentGrants),
        JSON.stringify(bundle.previousStates),
        "2026-07-18T00:01:00Z",
      ],
    );
    await execSql(
      `INSERT INTO principal_policy_bundle_references
         (principal_type, principal_id, version, state_hash, key_epoch,
          key_fingerprint, bundle_version, bundle_state_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference.principalType,
        reference.principalId,
        reference.version,
        reference.stateHash,
        reference.keyEpoch,
        reference.keyFingerprint,
        bundle.currentState.version,
        competingStateHash,
      ],
    );

    await expect(
      loadPrincipalPolicyBundleForReference(execSql, reference, null),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
  } finally {
    close();
  }
});

test("exact principal policy lookup rejects conflicting orphaned index metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-orphan-index-conflict",
  );
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("Expected a predecessor state");
    }
    const reference = referencedPrincipalStateFromPolicyState(previousState);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");
    await execSql(
      `INSERT INTO principal_policy_bundle_references
         (principal_type, principal_id, version, state_hash, key_epoch,
          key_fingerprint, bundle_version, bundle_state_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference.principalType,
        reference.principalId,
        reference.version,
        reference.stateHash,
        reference.keyEpoch,
        reference.keyFingerprint,
        bundle.currentState.version,
        "f".repeat(64),
      ],
    );
    await execSql(
      `DELETE FROM principal_policies
       WHERE principal_type = ? AND principal_id = ?`,
      [reference.principalType, reference.principalId],
    );

    await expect(
      loadPrincipalPolicyBundleForReference(execSql, reference, null),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
  } finally {
    close();
  }
});
