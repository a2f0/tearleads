import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  predecessorBundleFromSuccessor,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";

test("principal policy sync rejects rollback after the mutable bundle cache is cleared", async () => {
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

    const olderBundle = predecessorBundleFromSuccessor(bundle);
    const logs: string[] = [];
    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => olderBundle,
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(olderBundle)],
    });

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: principal policy state is older than the local checkpoint",
    );
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
