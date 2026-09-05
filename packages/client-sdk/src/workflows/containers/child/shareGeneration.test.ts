import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
} from "../../../../test/helpers/containerFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
} from "../../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { shareRemoteContainer, shareRemoteContainerWithGroup } from "./share";

test("share planning rolls back checkpoints after its generation expires", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-generation");
  let shareCallCount = 0;
  let transactionStarted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
      transactionStarted = true;
    }
    return rows;
  }) as ExecSql;

  try {
    const shared = await shareRemoteContainer({
      reportSecurityIncident: async () => {},
      accessLevel: "write",
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async () => {
          shareCallCount += 1;
          throw new Error("A stale share must not be submitted");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: guardedExecSql,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      stillCurrent: () => !transactionStarted,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    expect(transactionStarted).toBe(true);
    expect(shareCallCount).toBe(0);
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
        "container",
        parent.projection.organizationId,
        parent.projection.containerId,
      ),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});

test.each([
  false,
  true,
])("shareRemoteContainer respects a refused checkpoint commit (guard revives: %s)", async (reviveGuard) => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-submit-generation");
  let current = true;

  try {
    const shared = await shareRemoteContainer({
      reportSecurityIncident: async () => {},
      accessLevel: "write",
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async (_containerId, request) => {
          const response = await createMutationResponseFromRequest(request);
          current = false;
          return response;
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      stillCurrent: () => {
        const permitted = current;
        // A later guard evaluation cannot turn a rolled-back acknowledgement
        // into a completed mutation, even if the host reports current again.
        if (reviveGuard) current = true;
        return permitted;
      },
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
        "container",
        parent.projection.organizationId,
        parent.projection.containerId,
      ),
    ).resolves.toMatchObject({ epoch: 1 });
  } finally {
    database.close();
  }
});

test("a group share does not acknowledge a policy after its generation expires during commit", async () => {
  const parent = await createParentProjection();
  const author = parent.author;
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const groupId = "generation-race-group";
  const memberGroupId = "generation-race-members";
  const initialGroupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId,
      name: "Generation race group",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  let groupPolicy = initialGroupPolicy;
  let organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: groupId,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(groupPolicy),
        principalPolicyHead(groupPolicy, memberGroupId),
      ],
      memberGroupId,
      organizationId: parent.projection.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
    }),
  );
  const database = await createTestExecSql("group-share-commit-generation");
  let current = true;
  let submissions = 0;

  try {
    const shared = await shareRemoteContainerWithGroup({
      reportSecurityIncident: async () => {},
      accessLevel: "read",
      apiClient: {
        reciteContainer: async () => null,
        commitOrganizationGroupPolicy: async (
          _organizationId,
          _groupId,
          mutation,
        ) => {
          submissions += 1;
          groupPolicy = await policyBundleAfterMutation({
            mutation: mutation.groupPolicy,
            previous: groupPolicy,
          });
          organizationPolicy = await policyBundleAfterMutation({
            mutation: mutation.organizationPolicy,
            previous: organizationPolicy,
          });
          const containerMutations = await Promise.all(
            (mutation.groupPolicy.containerMutations ?? []).map((request) =>
              createMutationResponseFromRequest(request),
            ),
          );
          current = false;
          return {
            groupPolicy: { ...groupPolicy, containerMutations },
            organizationPolicy: {
              ...organizationPolicy,
              containerMutations: [],
            },
          };
        },
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          if (principalType === "organization") return organizationPolicy;
          expect(principalId).toBe(groupId);
          return groupPolicy;
        },
        shareContainer: async () => {
          throw new Error("Compound group share must use the policy PUT");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      expectedGroupName: "Generation race group",
      recipientGroupId: groupId,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
          userId,
        }),
      signingKeyPair,
      stillCurrent: () => current,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    expect(submissions).toBe(1);
    expect(
      await loadPrincipalPolicyCheckpoint(database.execSql, "group", groupId),
    ).toMatchObject({
      stateHash: initialGroupPolicy.currentState.stateHash,
      version: initialGroupPolicy.currentState.version,
    });
    expect(
      (await loadPrincipalPolicyBundle(database.execSql, "group", groupId))
        ?.currentState.stateHash,
    ).toBe(initialGroupPolicy.currentState.stateHash);
  } finally {
    database.close();
  }
});

test("a missing group grant returns null when projection verification expires", async () => {
  const parent = await createParentProjection();
  const author = parent.author;
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const groupId = "expired-preparation-group";
  const memberGroupId = "expired-preparation-members";
  const groupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId,
      name: "Expired preparation group",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: groupId,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(groupPolicy),
        principalPolicyHead(groupPolicy, memberGroupId),
      ],
      memberGroupId,
      organizationId: parent.projection.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
    }),
  );
  const database = await createTestExecSql(
    "group-share-preparation-generation",
  );
  const resolveProjectionUserKey =
    createParentProjectionUserKeyResolver(parent);
  let current = true;
  let projectionRequests = 0;
  let submissions = 0;

  try {
    const shared = await shareRemoteContainerWithGroup({
      reportSecurityIncident: async () => {},
      accessLevel: "read",
      apiClient: {
        reciteContainer: async () => null,
        commitOrganizationGroupPolicy: async () => {
          submissions += 1;
          throw new Error("Expired preparation must not be committed");
        },
        getContainerWriterProjection: async () => {
          projectionRequests += 1;
          return parent.projection;
        },
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          if (principalType === "organization") return organizationPolicy;
          expect(principalId).toBe(groupId);
          return groupPolicy;
        },
        shareContainer: async () => {
          throw new Error("Compound group share must use the policy PUT");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      expectedGroupName: "Expired preparation group",
      recipientGroupId: groupId,
      resolveProjectionUserKey,
      resolveTrustedUserIdentity: async (userId) => {
        const identity = createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
          userId,
        });
        if (projectionRequests > 1) current = false;
        return identity;
      },
      signingKeyPair,
      stillCurrent: () => current,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    expect(current).toBe(false);
    expect(submissions).toBe(0);
  } finally {
    database.close();
  }
});
