import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { cacheReferencedPolicies } from "../../../../test/helpers/policyCacheFixtures";
import { createPolicyDirectoryFixture } from "../../../../test/helpers/policyDirectoryFixtures";
import {
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  predecessorBundleFromSuccessor,
  referencedPrincipalStateFromBundle,
} from "../../../../test/helpers/principalPolicyBundles";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";

test("principal policy sync hard-fails rollback after the mutable bundle cache is cleared", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-durable-checkpoint",
  );
  try {
    const { bundle, getUserIdentity } =
      await createSuccessorPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: bundle,
    });
    await cacheReferencedPolicies({
      directory,
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });
    await expect(
      new KeyingCheckpointRepository(execSql).loadPrincipalPolicyCheckpoint(
        "group",
        "group-1",
      ),
    ).resolves.toMatchObject({
      version: bundle.currentState.version,
      stateHash: bundle.currentState.stateHash,
    });
    await execSql("DELETE FROM principal_policy_bundles WHERE is_current = 1");

    const olderBundle = predecessorBundleFromSuccessor(bundle);
    await expect(
      cacheReferencedPolicies({
        directory,
        organizationId: "org-1",
        execSql,
        getCurrentPrincipalPolicy: async () => olderBundle,
        getUserIdentity,
        references: [referencedPrincipalStateFromBundle(olderBundle)],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      name: "KeyingVerificationError",
    });
    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyBundle(
        "group",
        "group-1",
      ),
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
    const { bundle, getUserIdentity } = await createPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: bundle,
    });
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await execSql(`CREATE TRIGGER reject_principal_policy_bundle
      BEFORE INSERT ON principal_policy_bundles
      BEGIN
        SELECT RAISE(ABORT, 'injected principal policy bundle failure');
      END`);
    const logs: string[] = [];

    await cacheReferencedPolicies({
      directory,
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs.some((message) => message.includes("failed to store"))).toBe(
      true,
    );
    await expect(
      new KeyingCheckpointRepository(execSql).loadPrincipalPolicyCheckpoint(
        "group",
        "group-1",
      ),
    ).resolves.toBeNull();
    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyBundle(
        "group",
        "group-1",
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
