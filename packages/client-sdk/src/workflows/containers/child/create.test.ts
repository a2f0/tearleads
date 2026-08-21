import { expect, test } from "bun:test";
import {
  CONTAINER_KEK_MATERIAL_ID_PREFIX,
  computeContainerKekMaterialId,
  decryptWithDek,
  type KeyingCanonicalJson,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@symcrypt/crypto";
import { base64ToBytes } from "@symcrypt/encoding";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
} from "@symcrypt/validators/request";
import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  createAuthor,
  createDeepNonCanonicalRecord,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
  tamperFirstProjectionEventSignature,
} from "../../../../test/helpers/containerFixtures";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import {
  buildContainerCreatePlan,
  buildMaterializedContainerCreatePlan,
  createRemoteContainer,
} from "../index";

test("buildMaterializedContainerCreatePlan signs a child create and wraps the child KEK to the parent KEK only", async () => {
  const parent = await createParentProjection();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: "child-container",
    keyEpoch: 1,
    keyMaterial: containerKey,
  });
  const materialized = await buildMaterializedContainerCreatePlan({
    author,
    containerId: "child-container",
    containerKey,
    containerKeyEpochId,
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
    containerKeyEpochId,
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

test("buildMaterializedContainerCreatePlan rejects a KEK epoch id that does not commit to its material", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });

  await expect(
    buildMaterializedContainerCreatePlan({
      author,
      containerId: "mismatched-child-container",
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      containerKeyEpochId: `${CONTAINER_KEK_MATERIAL_ID_PREFIX}${"0".repeat(64)}`,
      parentProjection: parent.projection,
      parentSecretKey: parent.secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow(
    "Container key epoch id does not match the committed KEK material",
  );
});

test("buildContainerCreatePlan stamps the child with the parent's organization regardless of the author's", async () => {
  // A member writing under another org's shared root has a different personal
  // org than the parent. The child belongs to the parent's org (not the
  // author's), and the author supplies only the signer identity.
  const parent = await createParentProjection();
  const { author } = await createAuthor({ organizationId: "other-org" });

  const plan = await buildContainerCreatePlan({
    author,
    containerKey: crypto.getRandomValues(new Uint8Array(32)),
    parentKekMaterial: parent.parentContainerKek,
    parentProjection: parent.projection,
  });
  expect(plan.state.organizationId).toBe(parent.projection.organizationId);
  expect(plan.event.organizationId).toBe(parent.projection.organizationId);
  expect(plan.event.signerUserId).toBe(author.signerUserId);
});

test("buildContainerCreatePlan rejects stale parent projections and invalid key material", async () => {
  const parent = await createParentProjection();
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
  const { close, execSql } = await createTestExecSql("remote-child-create");
  try {
    const result = await createRemoteContainer({
      apiClient: {
        getContainerWriterProjection: async (containerId) =>
          containerId === parent.projection.containerId
            ? parent.projection
            : null,
        getCurrentPrincipalPolicy: async () => null,
        createContainer: async (request) => {
          submittedRequests.push(request);
          return createMutationResponseFromRequest(request);
        },
      },
      author,
      containerId: "remote-child-container",
      execSql,
      metadataDocumentId: "remote-child-container-metadata-document",
      parentContainerId: parent.projection.containerId,
      parentSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
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
    if (!result) {
      throw new Error("Expected remote container create result");
    }
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        result.plan.manifest.organizationId,
        result.plan.containerId,
      ),
    ).resolves.toEqual({
      objectKind: "container",
      objectId: result.plan.containerId,
      organizationId: result.plan.manifest.organizationId,
      epoch: result.plan.manifest.epoch,
      manifestHash: result.plan.manifestHash,
    });
  } finally {
    close();
  }
});

test("createRemoteContainer rejects a mismatched acknowledgement without pinning it", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const containerId = "remote-child-tampered-ack";
  const { close, execSql } = await createTestExecSql(
    "remote-child-tampered-ack",
  );
  try {
    await expect(
      createRemoteContainer({
        apiClient: {
          createContainer: async (request) => {
            const response = await createMutationResponseFromRequest(request);
            return {
              ...response,
              containerKek: {
                ...response.containerKek,
                keyTargetHash: "f".repeat(64),
              },
            };
          },
          getContainerWriterProjection: async () => parent.projection,
          getCurrentPrincipalPolicy: async () => null,
        },
        author,
        containerId,
        execSql,
        parentContainerId: parent.projection.containerId,
        parentSecretKey: parent.secretKey,
        reportSecurityIncident: async () => undefined,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        resolveTrustedUserIdentity:
          createParentProjectionUserKeyResolver(parent),
      }),
    ).rejects.toThrow("Container mutation response KEK commitment mismatch");
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        parent.projection.organizationId,
        containerId,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
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
  const { close, execSql } = await createTestExecSql(
    "remote-child-create-bad-parent",
  );

  try {
    await expect(
      createRemoteContainer({
        apiClient: {
          getContainerWriterProjection: async () => tamperedProjection,
          getCurrentPrincipalPolicy: async () => null,
          createContainer: async () => {
            createCalled = true;
            throw new Error("Unexpected create call");
          },
        },
        author,
        containerId: "bad-parent-signature-child",
        execSql,
        parentContainerId: parent.projection.containerId,
        parentSecretKey: parent.secretKey,
        reportSecurityIncident: async () => undefined,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        resolveTrustedUserIdentity:
          createParentProjectionUserKeyResolver(parent),
      }),
    ).rejects.toThrow(
      "Container writer projection path[0] signature verification failed",
    );
    expect(createCalled).toBe(false);
  } finally {
    close();
  }
});
