import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createSuccessorPrincipalPolicyBundle } from "../../../../test/helpers/data/principalPolicyBundles";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { PrincipalPolicyBundleRepository } from "./principalPolicyBundleRepository";
import { indexPrincipalPolicyBundleInTransaction } from "./principalPolicyReferenceIndexPersistence";

function competingHead(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse {
  const stateHash = "f".repeat(64);
  return {
    ...bundle,
    currentState: { ...bundle.currentState, stateHash },
    currentPayload: { ...bundle.currentPayload, stateHash },
    currentMemberEnvelopes: {
      ...bundle.currentMemberEnvelopes,
      stateHash,
    },
  };
}

test("principal policy reference indexing rejects competing bundle heads at one version", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-reference-index-head-conflict",
  );
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    await runtime.transaction(
      (tx) => indexPrincipalPolicyBundleInTransaction(tx, bundle),
      { behavior: "immediate" },
    );

    await expect(
      runtime.transaction(
        (tx) =>
          indexPrincipalPolicyBundleInTransaction(tx, competingHead(bundle)),
        { behavior: "immediate" },
      ),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
  } finally {
    close();
  }
});

test("principal policy reference indexing rejects a stored bundle-version mismatch", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-reference-index-version-conflict",
  );
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    const state = bundle.currentState;
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await execSql(
      `INSERT INTO principal_policy_bundle_references
         (principal_type, principal_id, version, state_hash, key_epoch,
          key_fingerprint, bundle_version, bundle_state_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.principalType,
        state.principalId,
        state.version,
        state.stateHash,
        state.keyEpoch,
        state.keyFingerprint,
        state.version + 1,
        state.stateHash,
      ],
    );

    await expect(
      getClientSQLitePersistenceRuntime(execSql).transaction(
        (tx) => indexPrincipalPolicyBundleInTransaction(tx, bundle),
        { behavior: "immediate" },
      ),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
  } finally {
    close();
  }
});
