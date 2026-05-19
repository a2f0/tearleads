import { expect, test } from "bun:test";
import {
  buildContainerCreatePlan,
  buildMaterializedContainerCreatePlan,
  createRemoteContainer,
} from "@tearleads/client-sdk/workflows/containers";
import {
  CONTAINER_KEK_MATERIAL_ID_PREFIX,
  computeContainerKekMaterialId,
  decryptWithDek,
  type KeyingCanonicalJson,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
} from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createDeepNonCanonicalRecord,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
  tamperFirstProjectionEventSignature,
} from "../../../../test/helpers/containerFixtures";

test("buildMaterializedContainerCreatePlan signs a child create and wraps the child KEK to the parent KEK only", async () => {
  const parent = await createParentProjection();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const materialized = await buildMaterializedContainerCreatePlan({
    author,
    containerId: "child-container",
    containerKey,
    containerKeyEpochId: "child-container-key-epoch-1",
    eventId: "child-container-event-1",
    metadataDocumentId: "child-container-metadata-document",
    parentProjection: parent.projection,
    parentSecretKey: parent.secretKey,
    signedAt: SIGNED_AT,
    trustedLocalProjection: true,
  });
  const { plan } = materialized;
  const parentManifestHash = parent.projection.path[0]?.manifestHash;
  if (!parentManifestHash) {
    throw new Error("Expected parent projection manifest");
  }

  expect(isContainerMutationRequest(plan.request)).toBe(true);
  expect(plan.body).toEqual({
    eventType: "container.create",
    parentContainerId: parent.projection.containerId,
    parentManifestHash,
    metadataDocumentId: "child-container-metadata-document",
    containerKeyEpochId: "child-container-key-epoch-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  });
  expect(plan.request.userRecipientKeys).toEqual([]);
  expect(plan.request.principalPolicies).toEqual([]);
  expect(
    plan.request.parentContainerPath?.map((bundle) => bundle.manifestHash),
  ).toEqual(parent.projection.path.map((bundle) => bundle.manifestHash));
  expect(plan.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: parent.parentKekState.containerId,
      recipientKeyEpochId: parent.parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: parent.parentKekState.keyEpochHash,
    },
  ]);
  expect(plan.wraps).toHaveLength(1);
  expect(plan.wraps[0]?.recipientKind).toBe("container");

  const verifiedEvent = await verifySignedAccessEvent({
    body: plan.body as unknown as KeyingCanonicalJson,
    event: plan.event,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }
  const verifiedManifest = await verifyContainerAccessManifest({
    event: verifiedEvent.value,
    expectedManifestHash: plan.manifestHash,
    manifest: plan.manifest,
    parentContainerPath: [
      parent.projection.path[0] as unknown as VerifiedContainerAccessManifest,
    ],
  });
  expect(verifiedManifest.ok).toBe(true);
  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }
  const verifiedKek = await verifyContainerKekState({
    containerManifest: verifiedManifest.value,
    keyEpoch: plan.keyEpoch,
    parentKekState: parent.parentKekState,
    wraps: plan.wraps,
  });
  expect(verifiedKek.ok).toBe(true);
  if (!verifiedKek.ok) {
    throw verifiedKek.error;
  }

  const [wrap] = plan.wraps;
  if (!wrap) {
    throw new Error("Expected child container KEK wrap");
  }
  const unwrappedChildKek = await decryptWithDek(
    {
      iv: base64ToBytes(wrap.kemCipherText),
      ciphertext: base64ToBytes(wrap.wrappedKey),
    },
    parent.parentContainerKek,
  );
  expect(Array.from(unwrappedChildKek)).toEqual(Array.from(containerKey));
  expect(verifiedKek.value.keyTargetHash).toBe(plan.keyTargetHash);
  expect(verifiedKek.value.keyEpochHash).toBe(plan.keyEpochHash);
});

test("buildMaterializedContainerCreatePlan commits generated KEK epoch ids to material", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const containerId = "committed-child-container";
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const materialized = await buildMaterializedContainerCreatePlan({
    author,
    containerId,
    containerKey,
    eventId: "committed-child-container-event",
    parentProjection: parent.projection,
    parentSecretKey: parent.secretKey,
    signedAt: SIGNED_AT,
    trustedLocalProjection: true,
  });

  expect(materialized.plan.containerKeyEpochId).toBe(
    await computeContainerKekMaterialId({
      containerId,
      keyEpoch: 1,
      keyMaterial: containerKey,
    }),
  );
  expect(
    materialized.plan.containerKeyEpochId.startsWith(
      CONTAINER_KEK_MATERIAL_ID_PREFIX,
    ),
  ).toBe(true);
});

test("buildContainerCreatePlan rejects stale parent projections and wrong organization authors", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({ organizationId: "other-org" });

  await expect(
    buildContainerCreatePlan({
      author,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentKekMaterial: parent.parentContainerKek,
      parentProjection: parent.projection,
    }),
  ).rejects.toThrow("organization");

  const validAuthor = (
    await createAuthor({ organizationId: parent.projection.organizationId })
  ).author;
  await expect(
    buildContainerCreatePlan({
      author: validAuthor,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentKekMaterial: parent.parentContainerKek,
      parentProjection: {
        ...parent.projection,
        containerKeks: [
          {
            ...parent.projection.containerKeks[0],
            accessManifestHash: "stale-parent-manifest-hash",
          } as ContainerWriterProjectionResponse["containerKeks"][number],
        ],
      },
    }),
  ).rejects.toThrow("stale");

  await expect(
    buildContainerCreatePlan({
      author: validAuthor,
      containerKey: crypto.getRandomValues(new Uint8Array(16)),
      parentKekMaterial: parent.parentContainerKek,
      parentProjection: parent.projection,
    }),
  ).rejects.toThrow("KEK material");
});

test("buildMaterializedContainerCreatePlan rejects non-canonical parent path records before request construction", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });

  await expect(
    buildMaterializedContainerCreatePlan({
      author,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentProjection: {
        ...parent.projection,
        path: parent.projection.path.map((bundle) => ({
          ...bundle,
          state: {
            ...bundle.state,
            wouldBeDroppedByJson: undefined,
          },
        })),
      },
      parentSecretKey: parent.secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("must be canonical JSON");
});

test("buildMaterializedContainerCreatePlan rejects deeply nested non-canonical parent records without overflowing", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });

  await expect(
    buildMaterializedContainerCreatePlan({
      author,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentProjection: {
        ...parent.projection,
        path: parent.projection.path.map((bundle) => ({
          ...bundle,
          event: {
            ...bundle.event,
            body: createDeepNonCanonicalRecord(20_000),
          },
        })),
      },
      parentSecretKey: parent.secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("must be canonical JSON");
});

test("createRemoteContainer fetches the parent projection and submits the materialized mutation", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const submittedRequests: ContainerMutationRequest[] = [];
  const result = await createRemoteContainer({
    apiClient: {
      getContainerWriterProjection: async (containerId) =>
        containerId === parent.projection.containerId
          ? parent.projection
          : null,
      createContainer: async (request) => {
        submittedRequests.push(request);
        return createMutationResponseFromRequest(request);
      },
    },
    author,
    containerId: "remote-child-container",
    containerKeyEpochId: "remote-child-container-key-epoch-1",
    metadataDocumentId: "remote-child-container-metadata-document",
    parentContainerId: parent.projection.containerId,
    parentSecretKey: parent.secretKey,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    signedAt: SIGNED_AT,
  });

  expect(result?.containerId).toBe("remote-child-container");
  expect(result?.metadataDocumentId).toBe(
    "remote-child-container-metadata-document",
  );
  expect(submittedRequests).toHaveLength(1);
  expect(submittedRequests[0]?.expectedManifestHash).toBe(
    result?.plan.manifestHash,
  );
  expect(isContainerMutationRequest(result?.plan.request)).toBe(true);
});

test("createRemoteContainer rejects bad parent projection signatures before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const tamperedProjection = tamperFirstProjectionEventSignature(
    parent.projection,
  );
  let createCalled = false;

  await expect(
    createRemoteContainer({
      apiClient: {
        getContainerWriterProjection: async () => tamperedProjection,
        createContainer: async () => {
          createCalled = true;
          throw new Error("Unexpected create call");
        },
      },
      author,
      containerId: "bad-parent-signature-child",
      parentContainerId: parent.projection.containerId,
      parentSecretKey: parent.secretKey,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  expect(createCalled).toBe(false);
});
