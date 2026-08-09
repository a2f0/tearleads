import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";

function predecessorBundle(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse {
  const previous = bundle.previousStates[0];
  if (!previous) {
    throw new Error("Expected successor policy state");
  }
  return {
    currentMemberEnvelopes: {
      principalType: previous.state.principalType,
      principalId: previous.state.principalId,
      stateHash: previous.state.stateHash,
      epoch: previous.state.keyEpoch,
      envelopes: [],
    },
    currentPayload: {
      principalType: previous.state.principalType,
      principalId: previous.state.principalId,
      stateHash: previous.state.stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: "cached-previous-ciphertext",
      ciphertextHash: previous.state.payloadCiphertextHash,
      createdAt: previous.state.createdAt,
    },
    currentProjection: previous.projection,
    currentState: previous.state,
    previousStates: [],
  };
}

test("principal policy sync hard-fails rollback after the mutable bundle cache is cleared", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-durable-checkpoint",
  );
  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).resolves.toMatchObject({
      version: bundle.currentState.version,
      stateHash: bundle.currentState.stateHash,
    });
    await execSql("DELETE FROM principal_policies");

    const olderBundle = predecessorBundle(bundle);
    await expect(
      cacheReferencedPolicies({
        execSql,
        getCurrentPrincipalPolicy: async () => olderBundle,
        getUserIdentity: async () => signerKeyResponse,
        references: [referencedPrincipalStateFromBundle(olderBundle)],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      name: "KeyingVerificationError",
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync cannot pin a head when its full bundle write fails", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-atomic-bundle-checkpoint",
  );
  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    await execSql(`CREATE TRIGGER reject_principal_policy_bundle
      BEFORE INSERT ON principal_policies
      BEGIN
        SELECT RAISE(ABORT, 'injected principal policy bundle failure');
      END`);
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs.some((message) => message.includes("failed to store"))).toBe(
      true,
    );
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).resolves.toBeNull();
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
