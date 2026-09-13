import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  createUnauthorizedSuccessorPrincipalPolicyBundle,
  predecessorBundleFromSuccessor,
  referencedPrincipalStateFromBundle,
  referencedPrincipalStateFromPolicyState,
} from "../../../test/helpers/policyCacheFixtures";
import { createPolicyDirectoryFixture } from "../../../test/helpers/policyDirectoryFixtures";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";

test("principal policy sync caches a verified referenced principal bundle and skips refetching unchanged state", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: bundle,
    });
    let getCurrentPrincipalPolicyCallCount = 0;

    await cacheReferencedPolicies({
      directory,
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    await expect(
      loadPrincipalPolicyStateHash(execSql, "group", "group-1"),
    ).resolves.toBe(bundle.currentState.stateHash);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);

    await cacheReferencedPolicies({
      directory,
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(getCurrentPrincipalPolicyCallCount).toBe(1);
  } finally {
    close();
  }
});

test("principal policy sync fetches a newer referenced state when an older bundle is cached", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: bundle,
    });
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      predecessorBundleFromSuccessor(bundle),
      "2026-04-08T00:00:30.000Z",
      "org-1",
    );
    let getCurrentPrincipalPolicyCallCount = 0;

    await cacheReferencedPolicies({
      directory,
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(getCurrentPrincipalPolicyCallCount).toBe(1);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync verifies successor state from the fetched chain when no previous bundle is cached", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: bundle,
    });
    const logs: string[] = [];

    await cacheReferencedPolicies({
      directory,
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync caches current state when the reference points at a historical head", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: bundle,
    });
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected previous principal policy state");
    }
    const logs: string[] = [];

    await cacheReferencedPolicies({
      directory,
      organizationId: "org-1",
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromPolicyState(previousState)],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync reuses and re-verifies a cached successor for a historical reference", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-cached-successor-history",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: bundle,
    });
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected previous principal policy state");
    }
    let policyReadCount = 0;
    let signerReadCount = 0;
    const cache = (
      references: Parameters<typeof cacheReferencedPolicies>[0]["references"],
    ) =>
      cacheReferencedPolicies({
        directory,
        organizationId: "org-1",
        execSql,
        getCurrentPrincipalPolicy: async () => {
          policyReadCount += 1;
          return bundle;
        },
        getUserIdentity: async () => {
          signerReadCount += 1;
          return signerKeyResponse;
        },
        references,
      });

    await cache([referencedPrincipalStateFromBundle(bundle)]);
    await cache([referencedPrincipalStateFromPolicyState(previousState)]);

    expect(policyReadCount).toBe(1);
    // Reusing the stored bundle still runs normal signature verification; it is
    // a network-read optimization, not a trusted-object shortcut.
    expect(signerReadCount).toBe(2);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync rejects shrinking successors that reuse the key epoch", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle({
        shrinkWithoutRotation: true,
      });
    await expect(
      cacheReferencedPolicies({
        organizationId: "org-1",
        execSql,
        getCurrentPrincipalPolicy: async () => bundle,
        getUserIdentity: async () => signerKeyResponse,
        references: [referencedPrincipalStateFromBundle(bundle)],
      }),
    ).rejects.toMatchObject({
      code: "key_epoch_reuse",
      name: "KeyingVerificationError",
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync rejects bundles whose projection does not match the signed root", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    const [firstProjectionMember, ...remainingProjection] =
      bundle.currentProjection;
    if (!firstProjectionMember) {
      throw new Error("expected principal policy projection member");
    }
    const tamperedBundle: PrincipalPolicyBundleResponse = {
      ...bundle,
      currentProjection: [
        {
          ...firstProjectionMember,
          role: firstProjectionMember.role === "admin" ? "member" : "admin",
        },
        ...remainingProjection,
      ],
    };

    await expect(
      cacheReferencedPolicies({
        organizationId: "org-1",
        execSql,
        getCurrentPrincipalPolicy: async () => tamperedBundle,
        getUserIdentity: async () => signerKeyResponse,
        references: [referencedPrincipalStateFromBundle(bundle)],
      }),
    ).rejects.toMatchObject({
      code: "hash_mismatch",
      name: "KeyingVerificationError",
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync rejects successor bundles signed by non-admins", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponses } =
      await createUnauthorizedSuccessorPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    await expect(
      cacheReferencedPolicies({
        organizationId: "org-1",
        execSql,
        getCurrentPrincipalPolicy: async (principalType) =>
          principalType === "group" ? bundle : null,
        getUserIdentity: async (userId) =>
          signerKeyResponses.get(userId) ?? null,
        references: [referencedPrincipalStateFromBundle(bundle)],
      }),
    ).rejects.toMatchObject({
      code: "unauthorized",
      name: "KeyingVerificationError",
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync rejects bundles when the signer key does not match", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);

    await expect(
      cacheReferencedPolicies({
        organizationId: "org-1",
        execSql,
        getCurrentPrincipalPolicy: async () => bundle,
        getUserIdentity: async () => ({
          ...signerKeyResponse,
          signingKeyFingerprint: "mismatched-fingerprint",
        }),
        references: [referencedPrincipalStateFromBundle(bundle)],
      }),
    ).rejects.toMatchObject({
      code: "signer_mismatch",
      name: "KeyingVerificationError",
    });

    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
