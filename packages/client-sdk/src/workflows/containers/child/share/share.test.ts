import { expect, test } from "bun:test";
import {
  type ContainerUserRecipientKey,
  generateKemSeedAndKeyPair,
  type KeyingCanonicalJson,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
  SIGNED_AT,
  tamperFirstProjectionEventSignature,
} from "../../../../../test/helpers/data/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";

test("shareRemoteContainer rejects tampered projected container state before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-tampered-state");
  let shareCalled = false;
  await expect(
    createContainerMutationServiceFixture({
      reportSecurityIncident: async () => {},
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => ({
          ...parent.projection,
          path: parent.projection.path.map((bundle) => ({
            ...bundle,
            state: {
              ...bundle.state,
              directGrants: "not-grants",
            },
          })),
        }),
        shareContainer: async () => {
          shareCalled = true;
          throw new Error("Unexpected share call");
        },
      },
      execSql: database.execSql,
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      encapsulationSecretKey: parent.secretKey,
    }).shareRemoteContainer({
      accessLevel: "read",
      author,
      containerId: parent.projection.containerId,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    }),
  ).rejects.toThrow("Container writer projection path[0] state mismatch");
  database.close();
  expect(shareCalled).toBe(false);
});

test("shareRemoteContainer rejects bad previous projection signatures before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const tamperedProjection = tamperFirstProjectionEventSignature(
    parent.projection,
  );
  const database = await createTestExecSql(
    "container-share-tampered-signature",
  );
  let shareCalled = false;
  await expect(
    createContainerMutationServiceFixture({
      reportSecurityIncident: async () => {},
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => tamperedProjection,
        shareContainer: async () => {
          shareCalled = true;
          throw new Error("Unexpected share call");
        },
      },
      execSql: database.execSql,
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      encapsulationSecretKey: parent.secretKey,
    }).shareRemoteContainer({
      accessLevel: "read",
      author,
      containerId: parent.projection.containerId,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    }),
  ).rejects.toMatchObject({ code: "signature_mismatch" });
  database.close();
  expect(shareCalled).toBe(false);
});

test("shareRemoteContainer includes existing direct user recipient keys", async () => {
  const parent = await createParentProjection();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-user");
  const submittedRequests: ContainerMutationRequest[] = [];
  const shared = await createContainerMutationServiceFixture({
    reportSecurityIncident: async () => {},
    api: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => parent.projection,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        const response = await createMutationResponseFromRequest(request);
        return {
          ...response,
          containerKek: {
            ...response.containerKek,
            // Postgres returns wraps in recipient-key order, not request order.
            wraps: [...response.containerKek.wraps].reverse(),
          },
        };
      },
    },
    execSql: database.execSql,
    resolveTrustedUserIdentity: createRecipientIdentityResolver({
      encapsulationPublicKey: recipientKeyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey: parent.signingPublicKey,
    }),
    encapsulationSecretKey: parent.secretKey,
  }).shareRemoteContainer({
    accessLevel: "write",
    author,
    containerId: parent.projection.containerId,
    recipientUserId: "user-2",
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    signedAt: SIGNED_AT,
  });
  database.close();
  expect(shared).not.toBeNull();
  if (!shared) {
    throw new Error("Expected share result");
  }
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted share request");
  }
  const submittedUserRecipientKeys =
    submittedRequest.userRecipientKeys as unknown as ContainerUserRecipientKey[];
  expect(submittedUserRecipientKeys.map((key) => key.userId)).toEqual([
    "user-1",
    "user-2",
  ]);
  const verifiedEvent = await verifySignedAccessEvent({
    body: shared.plan.body as unknown as KeyingCanonicalJson,
    event: shared.plan.event,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }
  const previousManifest = parent.projection
    .path[0] as unknown as VerifiedContainerAccessManifest;
  const verifiedManifest = await verifyContainerAccessManifest({
    event: verifiedEvent.value,
    expectedManifestHash: shared.plan.manifestHash,
    manifest: shared.plan.manifest,
    previousManifest,
    previousContainerPath: [previousManifest],
  });
  expect(verifiedManifest.ok).toBe(true);
  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  const verifiedKek = await verifyContainerKekState({
    containerManifest: verifiedManifest.value,
    containerManifestHistory: [previousManifest],
    keyEpoch: shared.plan.keyEpoch,
    userRecipientKeys: submittedUserRecipientKeys,
    wraps: shared.plan.wraps,
  });
  expect(verifiedKek.ok).toBe(true);
  if (!verifiedKek.ok) {
    throw verifiedKek.error;
  }
  const ownerUserRecipientKey = submittedUserRecipientKeys[0];
  const peerUserRecipientKey = submittedUserRecipientKeys[1];
  if (!ownerUserRecipientKey || !peerUserRecipientKey) {
    throw new Error("Expected owner and peer recipient keys");
  }
  expect(verifiedKek.value.recipientTargets).toEqual([
    {
      recipientKind: "user",
      recipientId: "user-1",
      recipientKeyEpochId: ownerUserRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: ownerUserRecipientKey.recipientKeyFingerprint,
    },
    {
      recipientKind: "user",
      recipientId: "user-2",
      recipientKeyEpochId: peerUserRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: peerUserRecipientKey.recipientKeyFingerprint,
    },
  ]);
});
