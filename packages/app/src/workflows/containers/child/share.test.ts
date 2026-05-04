import { expect, test } from "bun:test";
import {
  type AccessEvent,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeAccessEventHash,
  computeContainerKeyEpochHash,
  generateKemSeedAndKeyPair,
  type KeyingCanonicalJson,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
} from "../../../data/containers/test-helpers";
import { shareRemoteContainer } from "../index";

test("shareRemoteContainer rejects malformed projected container state before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  let shareCalled = false;

  await expect(
    shareRemoteContainer({
      accessLevel: "read",
      apiClient: {
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
      author,
      containerId: parent.projection.containerId,
      recipientEncapsulationPublicKey: recipientKeyPair.publicKey,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("directGrants must be an array");
  expect(shareCalled).toBe(false);
});

test("shareRemoteContainer includes existing direct user recipient keys", async () => {
  const parent = await createParentProjection();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await shareRemoteContainer({
    accessLevel: "write",
    apiClient: {
      getContainerWriterProjection: async () => parent.projection,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        const event = request.event as unknown as AccessEvent;
        const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;
        const previousKek = parent.projection.containerKeks[0];
        if (!previousKek) {
          throw new Error("Expected parent projection KEK");
        }

        return {
          containerId: parent.projection.containerId,
          organizationId: parent.projection.organizationId,
          parentId: null,
          manifestHead: {
            epoch: 2,
            manifestHash: request.expectedManifestHash,
          },
          accessManifest: {
            event: {
              event: request.event,
              body: request.body,
              eventHash: await computeAccessEventHash(event),
            },
            manifest: request.manifest,
            manifestHash: request.expectedManifestHash,
            state: {},
          },
          containerKek: {
            ...previousKek,
            accessManifestHash: request.expectedManifestHash,
            keyEpoch: request.keyEpoch,
            keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
            wraps: request.wraps,
          },
          referencedPrincipalHeads: [],
        };
      },
    },
    author,
    containerId: parent.projection.containerId,
    recipientEncapsulationPublicKey: recipientKeyPair.publicKey,
    recipientUserId: "user-2",
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

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

test("shareRemoteContainer replaces stale wraps when re-sharing a user", async () => {
  const existingUserId = "user-2";
  const oldRecipientKeyPair = generateKemSeedAndKeyPair();
  const newRecipientKeyPair = generateKemSeedAndKeyPair();
  const oldRecipientKeyEpochId = `user:${existingUserId}:encapsulation:${await toFingerprint(oldRecipientKeyPair.publicKey)}`;
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "read",
      publicKey: oldRecipientKeyPair.publicKey,
      recipientKeyEpochId: oldRecipientKeyEpochId,
      userId: existingUserId,
    },
  });
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const previousKek = parent.projection.containerKeks[0];
  if (!previousKek) {
    throw new Error("Expected parent projection KEK");
  }
  const existingWrap = previousKek.wraps.find(
    (wrap) =>
      Reflect.get(wrap, "recipientKind") === "user" &&
      Reflect.get(wrap, "recipientId") === existingUserId,
  );
  if (!existingWrap) {
    throw new Error("Expected existing user wrap");
  }
  const existingRecipientTarget = previousKek.recipientTargets.find(
    (target) =>
      Reflect.get(target, "recipientKind") === "user" &&
      Reflect.get(target, "recipientId") === existingUserId,
  );
  if (!existingRecipientTarget) {
    throw new Error("Expected existing user recipient target");
  }
  const projectionWithExistingShare = parent.projection;
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await shareRemoteContainer({
    accessLevel: "write",
    apiClient: {
      getContainerWriterProjection: async () => projectionWithExistingShare,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        return createMutationResponseFromRequest(request);
      },
    },
    author,
    containerId: parent.projection.containerId,
    recipientEncapsulationPublicKey: newRecipientKeyPair.publicKey,
    recipientUserId: existingUserId,
    resolveProjectionUserKey: async (userId) => {
      if (userId === parent.userId) {
        return {
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        };
      }
      if (userId === existingUserId) {
        return {
          encapsulationPublicKey: oldRecipientKeyPair.publicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        };
      }

      return null;
    },
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

  expect(shared).not.toBeNull();
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted share request");
  }
  const submittedWraps =
    submittedRequest.wraps as unknown as ContainerKeyWrap[];
  const existingUserWraps = submittedWraps.filter(
    (wrap) =>
      wrap.recipientKind === "user" && wrap.recipientId === existingUserId,
  );
  expect(existingUserWraps).toHaveLength(1);
  expect(existingUserWraps[0]?.recipientKeyEpochId).not.toBe(
    oldRecipientKeyEpochId,
  );
  expect(submittedWraps).not.toContainEqual(
    expect.objectContaining({
      recipientId: existingUserId,
      recipientKeyEpochId: oldRecipientKeyEpochId,
    }),
  );
  expect(submittedWraps).toHaveLength(previousKek.wraps.length);
});
