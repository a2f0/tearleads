import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  predecessorBundleFromSuccessor,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import {
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";

test("referenced policy warming re-verifies an exact local bundle without a policy GET", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-warmer-exact-local",
  );
  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-07-18T00:00:00Z",
      "org-1",
    );
    let policyGetCount = 0;

    await cacheReferencedPolicies({
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => {
        policyGetCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(policyGetCount).toBe(0);
  } finally {
    close();
  }
});

test("referenced policy warming performs one policy GET for a local head mismatch", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-warmer-head-mismatch",
  );
  try {
    const { bundle: cachedBundle } = await createPrincipalPolicyBundle();
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      cachedBundle,
      "2026-07-18T00:00:00Z",
      "org-1",
    );
    let policyGetCount = 0;

    await cacheReferencedPolicies({
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => {
        policyGetCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(policyGetCount).toBe(1);
  } finally {
    close();
  }
});

test("referenced policy warming fetches once when the exact local chain is behind its checkpoint", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-warmer-behind-checkpoint",
  );
  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const cachedBundle = predecessorBundleFromSuccessor(bundle);
    const reference = referencedPrincipalStateFromBundle(cachedBundle);
    await savePrincipalPolicyBundle(
      execSql,
      cachedBundle,
      "2026-07-18T00:00:00Z",
      "org-1",
    );
    await execSql(
      `INSERT INTO principal_policy_checkpoints
         (principal_type, principal_id, version, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        bundle.currentState.principalType,
        bundle.currentState.principalId,
        bundle.currentState.version,
        bundle.currentState.stateHash,
        "2026-07-18T00:01:00Z",
      ],
    );
    let policyGetCount = 0;

    await cacheReferencedPolicies({
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => {
        policyGetCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [reference],
    });

    expect(policyGetCount).toBe(1);
  } finally {
    close();
  }
});

test("referenced policy warming leaves stale local state unchanged when the canonical bundle is unavailable", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-warmer-behind-checkpoint-unavailable",
  );
  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const cachedBundle = predecessorBundleFromSuccessor(bundle);
    await savePrincipalPolicyBundle(
      execSql,
      cachedBundle,
      "2026-07-18T00:00:00Z",
      "org-1",
    );
    await execSql(
      `INSERT INTO principal_policy_checkpoints
         (principal_type, principal_id, version, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        bundle.currentState.principalType,
        bundle.currentState.principalId,
        bundle.currentState.version,
        bundle.currentState.stateHash,
        "2026-07-18T00:01:00Z",
      ],
    );
    let policyGetCount = 0;

    await cacheReferencedPolicies({
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => {
        policyGetCount += 1;
        return null;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(cachedBundle)],
    });

    expect(policyGetCount).toBe(1);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(cachedBundle);
  } finally {
    close();
  }
});

test("referenced policy warming hard-fails and leaves stale local state unchanged when the canonical bundle is invalid", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-warmer-behind-checkpoint-invalid",
  );
  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const cachedBundle = predecessorBundleFromSuccessor(bundle);
    const firstMember = bundle.currentProjection[0];
    if (!firstMember) {
      throw new Error("Expected a current projection member");
    }
    const invalidBundle: PrincipalPolicyBundleResponse = {
      ...bundle,
      currentProjection: [
        {
          ...firstMember,
          role: firstMember.role === "admin" ? "member" : "admin",
        },
        ...bundle.currentProjection.slice(1),
      ],
    };
    await savePrincipalPolicyBundle(
      execSql,
      cachedBundle,
      "2026-07-18T00:00:00Z",
      "org-1",
    );
    await execSql(
      `INSERT INTO principal_policy_checkpoints
         (principal_type, principal_id, version, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        bundle.currentState.principalType,
        bundle.currentState.principalId,
        bundle.currentState.version,
        bundle.currentState.stateHash,
        "2026-07-18T00:01:00Z",
      ],
    );
    let policyGetCount = 0;

    await expect(
      cacheReferencedPolicies({
        organizationId: "org-1",
        execSql,
        getCurrentPrincipalPolicy: async () => {
          policyGetCount += 1;
          return invalidBundle;
        },
        getUserIdentity: async () => signerKeyResponse,
        references: [referencedPrincipalStateFromBundle(cachedBundle)],
      }),
    ).rejects.toMatchObject({
      code: "hash_mismatch",
      name: "KeyingVerificationError",
    });

    expect(policyGetCount).toBe(1);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(cachedBundle);
  } finally {
    close();
  }
});
