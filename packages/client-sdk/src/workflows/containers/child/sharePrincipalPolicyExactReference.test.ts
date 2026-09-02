import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { createSuccessorGroupPolicyBundle } from "../../../../test/helpers/groupPolicyFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { savePrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { loadVerifiedGroupSharePrincipalPolicy } from "./sharePrincipalPolicy";

async function createDirectoryFixture(
  input: { includeTargetHead?: boolean; successor?: boolean } = {},
) {
  const { author, signingPublicKey } = await createAuthor({
    organizationId: "organization-1",
    userId: "signer-user-1",
  });
  const memberKem = generateKemSeedAndKeyPair();
  const buildGroup = (groupId: string, name: string) =>
    buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: memberKem,
      groupId,
      name,
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
    });
  const initialAdmin = await buildGroup("admins-group", "Admins");
  const initialMember = await buildGroup("members-group", "Members");
  const initialTarget = await buildGroup("group-1", "Operators");
  const adminPolicy = await policyBundleFromInitialRequest(initialAdmin);
  const memberPolicy = await policyBundleFromInitialRequest(initialMember);
  const predecessor = await policyBundleFromInitialRequest(initialTarget);
  const targetPolicy = input.successor
    ? await createSuccessorGroupPolicyBundle({
        author,
        groupId: "group-1",
        groupKem: generateKemSeedAndKeyPair(),
        memberPublicKey: memberKem.publicKey,
        previousBundle: predecessor,
        signedAt: "2026-07-18T00:01:00Z",
        userId: author.signerUserId,
      })
    : predecessor;
  const organizationRequest = await buildInitialOrganizationPolicyRequest({
    adminGroupId: "admins-group",
    encapsulationPublicKey: memberKem.publicKey,
    groupHeads: [
      principalPolicyHead(adminPolicy),
      principalPolicyHead(memberPolicy),
      ...(input.includeTargetHead === false
        ? []
        : [principalPolicyHead(targetPolicy)]),
    ],
    memberGroupId: "members-group",
    organizationId: author.organizationId,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
      signingPublicKey,
    },
    userId: author.signerUserId,
  });
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    author.organizationId,
    organizationRequest,
  );
  const resolveTrustedUserIdentity = async (userId: string) =>
    userId === author.signerUserId
      ? createTestTrustedUserIdentity({
          encapsulationPublicKey: memberKem.publicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey,
          userId,
        })
      : null;
  const load = async (
    principalType: "group" | "organization",
    principalId: string,
    onTargetGet: () => void,
  ): Promise<PrincipalPolicyBundleResponse | null> => {
    if (principalType === "organization") {
      return organizationPolicy;
    }
    if (principalId === "admins-group") {
      return adminPolicy;
    }
    if (principalId === "members-group") {
      return memberPolicy;
    }
    onTargetGet();
    return targetPolicy;
  };
  return {
    load,
    organizationId: author.organizationId,
    predecessor,
    resolveTrustedUserIdentity,
    targetPolicy,
  };
}

test("expected group-head verification reuses an exact local bundle without a policy GET", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-share-policy-exact-local",
  );
  try {
    const fixture = await createDirectoryFixture();
    await savePrincipalPolicyBundle(
      execSql,
      fixture.targetPolicy,
      "2026-07-18T00:00:00Z",
    );
    let policyGetCount = 0;

    const verified = await loadVerifiedGroupSharePrincipalPolicy({
      apiClient: createMockApiClient({
        getCurrentPrincipalPolicy: (principalType, principalId) =>
          fixture.load(principalType, principalId, () => {
            policyGetCount += 1;
          }),
      }),
      execSql,
      expectedGroupHead: principalPolicyHead(fixture.targetPolicy),
      groupId: fixture.targetPolicy.currentState.principalId,
      organizationId: fixture.organizationId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
    });

    expect(verified.bundle).toEqual(fixture.targetPolicy);
    expect(policyGetCount).toBe(0);
  } finally {
    close();
  }
});

test("expected group-head verification fetches once when the local head is wrong", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-share-policy-wrong-local",
  );
  try {
    const fixture = await createDirectoryFixture({ successor: true });
    await savePrincipalPolicyBundle(
      execSql,
      fixture.predecessor,
      "2026-07-18T00:00:00Z",
    );
    let policyGetCount = 0;

    const verified = await loadVerifiedGroupSharePrincipalPolicy({
      apiClient: createMockApiClient({
        getCurrentPrincipalPolicy: (principalType, principalId) =>
          fixture.load(principalType, principalId, () => {
            policyGetCount += 1;
          }),
      }),
      execSql,
      expectedGroupHead: principalPolicyHead(fixture.targetPolicy),
      groupId: fixture.targetPolicy.currentState.principalId,
      organizationId: fixture.organizationId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
    });

    expect(verified.bundle).toEqual(fixture.targetPolicy);
    expect(policyGetCount).toBe(1);
  } finally {
    close();
  }
});

test("signed organization directory permits an exact cached group bundle", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-share-policy-network-fresh",
  );
  try {
    const fixture = await createDirectoryFixture();
    await savePrincipalPolicyBundle(
      execSql,
      fixture.targetPolicy,
      "2026-07-18T00:00:00Z",
    );
    let policyGetCount = 0;

    await loadVerifiedGroupSharePrincipalPolicy({
      apiClient: createMockApiClient({
        getCurrentPrincipalPolicy: (principalType, principalId) =>
          fixture.load(principalType, principalId, () => {
            policyGetCount += 1;
          }),
      }),
      execSql,
      groupId: fixture.targetPolicy.currentState.principalId,
      organizationId: fixture.organizationId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
    });

    expect(policyGetCount).toBe(0);
  } finally {
    close();
  }
});

test("a cold client rejects a stale group head served below the signed organization directory", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-share-policy-signed-directory-stale",
  );
  try {
    const fixture = await createDirectoryFixture({ successor: true });

    await expect(
      loadVerifiedGroupSharePrincipalPolicy({
        apiClient: createMockApiClient({
          getCurrentPrincipalPolicy: (principalType, principalId) => {
            if (
              principalType === "group" &&
              principalId === fixture.targetPolicy.currentState.principalId
            ) {
              return Promise.resolve(fixture.predecessor);
            }
            return fixture.load(principalType, principalId, () => undefined);
          },
        }),
        execSql,
        groupId: fixture.targetPolicy.currentState.principalId,
        organizationId: fixture.organizationId,
        resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
      }),
    ).rejects.toThrow(
      "group policy does not match the signed organization directory",
    );
  } finally {
    close();
  }
});

test("a cold client rejects a deleted group replayed outside the signed organization directory", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-share-policy-signed-directory-deleted",
  );
  try {
    const fixture = await createDirectoryFixture({ includeTargetHead: false });

    await expect(
      loadVerifiedGroupSharePrincipalPolicy({
        apiClient: createMockApiClient({
          getCurrentPrincipalPolicy: (principalType, principalId) =>
            fixture.load(principalType, principalId, () => undefined),
        }),
        execSql,
        groupId: fixture.targetPolicy.currentState.principalId,
        organizationId: fixture.organizationId,
        resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
      }),
    ).rejects.toThrow("absent from the signed organization directory");
  } finally {
    close();
  }
});

test("share policy verification rolls back retained policies after generation expiry", async () => {
  const database = await createTestExecSql(
    "group-share-policy-generation-expiry",
  );
  let transactionStarted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
      transactionStarted = true;
    }
    return rows;
  }) as ExecSql;

  try {
    const fixture = await createDirectoryFixture();
    await loadVerifiedGroupSharePrincipalPolicy({
      apiClient: createMockApiClient({
        getCurrentPrincipalPolicy: (principalType, principalId) =>
          fixture.load(principalType, principalId, () => undefined),
      }),
      execSql: guardedExecSql,
      groupId: fixture.targetPolicy.currentState.principalId,
      organizationId: fixture.organizationId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
      stillCurrent: () => !transactionStarted,
    });

    expect(transactionStarted).toBe(true);
    for (const [principalType, principalId] of [
      ["organization", fixture.organizationId],
      ["group", "admins-group"],
      ["group", fixture.targetPolicy.currentState.principalId],
    ] as const) {
      expect(
        await loadPrincipalPolicyCheckpoint(
          database.execSql,
          principalType,
          principalId,
        ),
      ).toBeNull();
    }
  } finally {
    database.close();
  }
});
