import { expect, test } from "bun:test";
import {
  type AccessEvent,
  BLOB_CONTENT_KEY_WRAP_SUITE,
  type ContainerKeyEpoch,
  computeAccessEventHash,
  computeBlobAccessManifestHash,
  computeContainerKekKeyringHash,
  computeContainerKekMaterialId,
  computeContainerKekPredecessorBridgeHash,
  computeWriteHeaderHash,
  createContainerKekPredecessorBridge,
  deriveContainerKekWrappingPublicKey,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sealContainerKekKeyring,
  toFingerprint,
  unwrapContentKey,
  type VerifiedContainerAccessManifest,
  verifyContainerKekState,
  type WriteHeader,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql, type TestExecSql } from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createMultipartBlobStageFixture } from "../../../../test/helpers/blobUploadFixtures";
import {
  createContainerRevokeManifestFixture,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createUserContainerWrap,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import {
  createChildContainerProjection,
  moveContainerProjection,
} from "../../../../test/helpers/projectionHierarchy";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { uploadDocumentAttachment } from "../../../workflows/blobs/upload";
import { buildMaterializedDocumentCreatePlan } from "../../../workflows/documents/create";
import type { BlobBytes } from "../../blobContracts";
import { unwrapContainerKekPath } from "../../documents/shared/containerKekPath";
import { unwrapDocumentContentKeyTarget } from "../../documents/shared/projectionContentKeys";

async function withProjectionDatabase<T>(
  name: string,
  run: (execSql: TestExecSql) => Promise<T>,
): Promise<T> {
  const { close, execSql } = await createTestExecSql(name);
  try {
    return await run(execSql);
  } finally {
    close();
  }
}

test("unwrapContainerKekPath verifies signed projection events before unwrap", async () => {
  const parent = await createParentProjection();
  const tamperedProjection = structuredClone(parent.projection);
  const event = Reflect.get(tamperedProjection.path[0]?.event ?? {}, "event");
  if (!event || typeof event !== "object") {
    throw new Error("Expected projection event");
  }
  Reflect.set(event, "signature", bytesToBase64(new Uint8Array(64)));

  await withProjectionDatabase(
    "projection-tampered-event",
    async (execSql) =>
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: tamperedProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow("signature"),
  );
});

test("unwrapContainerKekPath rejects projection wraps not justified by the manifest", async () => {
  const parent = await createParentProjection();
  const attackerUserId = "attacker-user";
  const attackerKeyPair = generateKemSeedAndKeyPair();
  const attackerFingerprint = await toFingerprint(attackerKeyPair.publicKey);
  const attackerWrap = await createUserContainerWrap({
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    containerKek: parent.parentContainerKek,
    publicKey: attackerKeyPair.publicKey,
    recipientKeyEpochId: `user:${attackerUserId}:encapsulation:${attackerFingerprint}`,
    userId: attackerUserId,
    wrapManifestHash: parent.parentKekState.accessManifestHash,
  });
  const tamperedProjection = structuredClone(parent.projection);
  const kek = tamperedProjection.containerKeks[0];
  if (!kek) {
    throw new Error("Expected projection KEK");
  }
  kek.wraps = [...kek.wraps, attackerWrap];

  await withProjectionDatabase(
    "projection-unjustified-wrap",
    async (execSql) =>
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: tamperedProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow("KEK verification failed"),
  );
});

test("unwrapContainerKekPath rejects substituted material for committed KEK ids", async () => {
  const parent = await createParentProjection();
  const target = parent.parentKekState.recipientTargets.find(
    (candidate) =>
      candidate.recipientKind === "user" &&
      candidate.recipientId === parent.userId,
  );
  if (!target) {
    throw new Error("Expected parent user recipient target");
  }

  const substituteKek = crypto.getRandomValues(new Uint8Array(32));
  const substituteWrap = await createUserContainerWrap({
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    containerKek: substituteKek,
    publicKey: parent.encapsulationPublicKey,
    recipientKeyEpochId: target.recipientKeyEpochId,
    userId: parent.userId,
    wrapManifestHash: parent.parentKekState.accessManifestHash,
  });
  const tamperedProjection = structuredClone(parent.projection);
  const kek = tamperedProjection.containerKeks[0];
  if (!kek) {
    throw new Error("Expected projection KEK");
  }
  kek.wraps = [substituteWrap];

  await withProjectionDatabase(
    "projection-substituted-kek",
    async (execSql) =>
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: tamperedProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow("KEK material does not match committed epoch id"),
  );
});

test("unwrapContainerKekPath verifies move-back-to-root projections with historical parent proofs", async () => {
  const parent = await createParentProjection();
  const parentA = await createChildContainerProjection({
    containerId: "projection-parent-a",
    parent,
    parentProjection: parent.projection,
  });
  const movedChild = await createChildContainerProjection({
    containerId: "projection-moved-child",
    parent,
    parentProjection: parent.projection,
  });
  const movedUnderParentA = await moveContainerProjection({
    containerId: movedChild.projection.containerId,
    destinationParentProjection: parentA.projection,
    eventId: "projection-moved-child-under-parent-a",
    manifestHistory: [movedChild.bundle],
    parent,
    sourceProjection: movedChild.projection,
  });
  const movedBackToRoot = await moveContainerProjection({
    containerId: movedChild.projection.containerId,
    destinationParentProjection: parent.projection,
    eventId: "projection-moved-child-back-to-root",
    manifestHistory: [
      movedUnderParentA.bundle,
      movedChild.bundle,
      parentA.bundle,
    ],
    parent,
    sourceProjection: movedUnderParentA.projection,
  });

  const missingHistoricalParentProjection = structuredClone(
    movedBackToRoot.projection,
  );
  const movedBackKek = missingHistoricalParentProjection.containerKeks.at(-1);
  if (!movedBackKek) {
    throw new Error("Expected moved-back KEK");
  }
  movedBackKek.containerManifestHistory = [
    movedUnderParentA.bundle,
    movedChild.bundle,
  ];
  const unwrappedKeks = await withProjectionDatabase(
    "projection-move-back-to-root",
    async (execSql) => {
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: missingHistoricalParentProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow(
        // The previous manifest was moved under parent A and cites A's head;
        // with A's proof withheld that head cannot be resolved.
        "Container writer projection path[1] previous manifest does not cite a served head of its parent container projection-parent-a",
      );
      return unwrapContainerKekPath({
        execSql,
        projection: movedBackToRoot.projection,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        secretKey: parent.secretKey,
      });
    },
  );
  const movedBackKekId =
    movedBackToRoot.projection.containerKeks.at(-1)?.containerKeyEpochId;
  if (!movedBackKekId) {
    throw new Error("Expected moved-back container KEK id");
  }

  expect(movedUnderParentA.containerKey).not.toEqual(movedChild.containerKey);
  expect(movedBackToRoot.containerKey).not.toEqual(
    movedUnderParentA.containerKey,
  );
  expect(Array.from(unwrappedKeks.get(movedBackKekId) ?? [])).toEqual(
    Array.from(movedBackToRoot.containerKey),
  );
  const originalKekId =
    movedChild.projection.containerKeks.at(-1)?.containerKeyEpochId;
  if (!originalKekId) {
    throw new Error("Expected original moved container KEK id");
  }
  expect(Array.from(unwrappedKeks.get(originalKekId) ?? [])).toEqual(
    Array.from(movedChild.containerKey),
  );
});

test("unwrapContainerKekPath rejects revoked users after KEK epoch rotation", async () => {
  const revokedUserId = "user-2";
  const revokedKeyPair = generateKemSeedAndKeyPair();
  const revokedSigning = generateSigningSeedAndKeyPair();
  const revokedRecipientKeyFingerprint = await toFingerprint(
    revokedKeyPair.publicKey,
  );
  const revokedRecipientKeyEpochId = `user:${revokedUserId}:encapsulation:${revokedRecipientKeyFingerprint}`;
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: revokedKeyPair.publicKey,
      recipientKeyEpochId: revokedRecipientKeyEpochId,
      userId: revokedUserId,
    },
  });
  const resolveProjectionUserKey = async (userId: string) => {
    if (userId === parent.userId) {
      return createTestTrustedUserIdentity({
        encapsulationPublicKey: parent.encapsulationPublicKey,
        signingKeyFingerprint: parent.author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
        userId,
      });
    }
    if (userId === revokedUserId) {
      return createTestTrustedUserIdentity({
        encapsulationPublicKey: revokedKeyPair.publicKey,
        signingKeyFingerprint: "revoked-user-signing-fingerprint",
        signingPublicKey: revokedSigning.signingPublicKey,
        userId,
      });
    }

    return null;
  };
  const { close: closeProjectionDb, execSql } = await createTestExecSql(
    "projection-revoked-user",
  );

  try {
    const revokedUserPreviousKeks = await unwrapContainerKekPath({
      execSql,
      projection: parent.projection,
      resolveProjectionUserKey,
      secretKey: revokedKeyPair.secretKey,
    });
    const previousContainerKek = revokedUserPreviousKeks.get(
      parent.parentKekState.containerKeyEpochId,
    );
    if (!previousContainerKek) {
      throw new Error("Expected revoked user to unwrap the pre-revocation KEK");
    }

    const previousManifest = parent.projection
      .path[0] as unknown as VerifiedContainerAccessManifest;
    const rotatedContainerKek = crypto.getRandomValues(new Uint8Array(32));
    const rotatedContainerKeyEpochId = await computeContainerKekMaterialId({
      containerId: parent.parentKekState.containerId,
      keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
      keyMaterial: rotatedContainerKek,
    });
    const predecessorBridge = await createContainerKekPredecessorBridge({
      containerId: parent.parentKekState.containerId,
      predecessorContainerKey: parent.parentContainerKek,
      predecessorContainerKeyEpochId: parent.parentKekState.containerKeyEpochId,
      successorContainerKey: rotatedContainerKek,
      successorContainerKeyEpochId: rotatedContainerKeyEpochId,
    });
    const keyring = await sealContainerKekKeyring({
      containerId: parent.parentKekState.containerId,
      entries: [
        {
          containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
          keyMaterial: parent.parentContainerKek,
        },
      ],
      keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
      successorContainerKey: rotatedContainerKek,
      successorContainerKeyEpochId: rotatedContainerKeyEpochId,
    });
    const revokedManifest = await createContainerRevokeManifestFixture({
      containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
        containerId: parent.parentKekState.containerId,
        keyMaterial: rotatedContainerKek,
      }),
      author: parent.author,
      containerId: parent.parentKekState.containerId,
      containerKeyEpochId: rotatedContainerKeyEpochId,
      eventId: "parent-container-revoke-event-2",
      keyringHash: await computeContainerKekKeyringHash(keyring),
      organizationId: parent.projection.organizationId,
      predecessorBridgeHash:
        await computeContainerKekPredecessorBridgeHash(predecessorBridge),
      previousManifest,
      subjectId: revokedUserId,
      subjectType: "user",
      signingPublicKey: parent.signingPublicKey,
    });
    const ownerRecipientKeyFingerprint = await toFingerprint(
      parent.encapsulationPublicKey,
    );
    const ownerRecipientKeyEpochId = `user:${parent.userId}:encapsulation:${ownerRecipientKeyFingerprint}`;
    const ownerWrap = await createUserContainerWrap({
      containerKeyEpochId: rotatedContainerKeyEpochId,
      containerKek: rotatedContainerKek,
      publicKey: parent.encapsulationPublicKey,
      recipientKeyEpochId: ownerRecipientKeyEpochId,
      userId: parent.userId,
      wrapManifestHash: revokedManifest.manifestHash,
    });
    const rotatedKeyEpoch: ContainerKeyEpoch = {
      id: rotatedContainerKeyEpochId,
      containerId: parent.parentKekState.containerId,
      keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
      accessManifestHash: revokedManifest.manifestHash,
      parentContainerKeyEpochId: null,
      createdByEventHash: revokedManifest.event.eventHash,
      createdByManifestHash: revokedManifest.manifestHash,
    };
    const verifiedRotatedKek = await verifyContainerKekState({
      containerManifest: revokedManifest,
      keyEpoch: rotatedKeyEpoch,
      userRecipientKeys: [
        {
          recipientKeyEpochId: ownerWrap.recipientKeyEpochId,
          recipientKeyFingerprint: ownerWrap.recipientKeyFingerprint,
          userId: parent.userId,
        },
      ],
      wraps: [ownerWrap],
    });
    expect(verifiedRotatedKek.ok).toBe(true);
    if (!verifiedRotatedKek.ok) {
      throw verifiedRotatedKek.error;
    }
    const rotatedKekState = verifiedRotatedKek.value;
    const revokedProjection: ContainerWriterProjectionResponse = {
      policyEvidence: {
        organization: null,
        organizationPayloads: [],
        groups: [],
      },
      containerId: parent.projection.containerId,
      organizationId: parent.projection.organizationId,
      path: [
        revokedManifest as unknown as ContainerWriterProjectionResponse["path"][number],
      ],
      containerKeks: [
        {
          ...(rotatedKekState as unknown as ContainerWriterProjectionResponse["containerKeks"][number]),
          containerManifestHistory: [
            previousManifest as unknown as ContainerWriterProjectionResponse["path"][number],
          ],
          keyring,
        },
      ],
    };

    expect(revokedManifest.state.directGrants).toEqual([
      {
        subjectType: "user",
        subjectId: parent.userId,
        accessLevel: "admin",
      },
    ]);
    expect(
      rotatedKekState.recipientTargets.map((target) => target.recipientId),
    ).toEqual([parent.userId]);
    const ownerRotatedKeks = await unwrapContainerKekPath({
      execSql,
      projection: revokedProjection,
      resolveProjectionUserKey,
      secretKey: parent.secretKey,
    });
    expect(
      Array.from(ownerRotatedKeks.get(rotatedContainerKeyEpochId) ?? []),
    ).toEqual(Array.from(rotatedContainerKek));

    const preparedRewrapKeks = await unwrapContainerKekPath({
      execSql,
      knownContainerKeks: new Map([
        [rotatedContainerKeyEpochId, rotatedContainerKek],
      ]),
      projection: revokedProjection,
      resolveProjectionUserKey,
      secretKey: revokedKeyPair.secretKey,
    });
    expect(
      Array.from(
        preparedRewrapKeks.get(parent.parentKekState.containerKeyEpochId) ?? [],
      ),
    ).toEqual(Array.from(parent.parentContainerKek));

    const substitutedProjection = structuredClone(revokedProjection);
    const substitutedKeyring = substitutedProjection.containerKeks[0]?.keyring;
    if (!substitutedKeyring) {
      throw new Error("Expected projected rotation keyring");
    }
    const tamperedSealed = base64ToBytes(substitutedKeyring.sealed);
    tamperedSealed[8] = (tamperedSealed[8] ?? 0) ^ 0xff;
    Reflect.set(substitutedKeyring, "sealed", bytesToBase64(tamperedSealed));
    const ownerKeksWithCorruptHistory = await unwrapContainerKekPath({
      execSql,
      projection: substitutedProjection,
      resolveProjectionUserKey,
      secretKey: parent.secretKey,
    });
    expect(ownerKeksWithCorruptHistory.get(rotatedContainerKeyEpochId)).toEqual(
      rotatedContainerKek,
    );
    expect(
      ownerKeksWithCorruptHistory.has(
        parent.parentKekState.containerKeyEpochId,
      ),
    ).toBe(false);

    await expect(
      unwrapContainerKekPath({
        execSql,
        projection: revokedProjection,
        resolveProjectionUserKey,
        secretKey: revokedKeyPair.secretKey,
      }),
    ).rejects.toThrow("could not be unwrapped");

    const contentKey = crypto.getRandomValues(new Uint8Array(32));
    const createdDocumentId = "550e8400-e29b-41d4-a716-446655440700";
    const createdDocument = await buildMaterializedDocumentCreatePlan({
      author: parent.author,
      containerProjection: revokedProjection,
      contentKey,
      documentId: createdDocumentId,
      eventId: "document-after-revoke-event",
      execSql,
      resolveProjectionUserKey,
      signedAt: SIGNED_AT,
      targetSecretKey: parent.secretKey,
    });
    const [targetEnvelope] =
      createdDocument.plan.request.contentKeyBundle.targets;
    if (!targetEnvelope) {
      throw new Error("Expected document content-key target");
    }
    expect(createdDocument.plan.targets).toEqual([
      {
        containerId: parent.projection.containerId,
        containerManifestHash: revokedManifest.manifestHash,
        containerKeyEpoch: 2,
        containerKeyEpochId: rotatedContainerKeyEpochId,
      },
    ]);
    const sealedFor = { contentKeyEpoch: 1, documentId: createdDocumentId };
    const ownerContentKey = await unwrapDocumentContentKeyTarget({
      containerKek: rotatedContainerKek,
      ...sealedFor,
      envelope: targetEnvelope,
    });
    expect(Array.from(ownerContentKey)).toEqual(Array.from(contentKey));
    await expect(
      unwrapDocumentContentKeyTarget({
        containerKek: previousContainerKek,
        ...sealedFor,
        envelope: targetEnvelope,
      }),
    ).rejects.toThrow();
    const documentWriterProjection: DocumentWriterProjectionResponse = {
      policyEvidence: {
        organization: null,
        organizationPayloads: [],
        groups: [],
      },
      authorizingContainerPaths: [revokedProjection],
      contentKeyBundle: {
        documentId: createdDocument.plan.documentId,
        contentKeyEpoch:
          createdDocument.plan.request.contentKeyBundle.contentKeyEpoch,
        linkSetManifestHash:
          createdDocument.plan.request.contentKeyBundle.linkSetManifestHash,
        targetHash: createdDocument.plan.request.contentKeyBundle.targetHash,
        targets: [...createdDocument.plan.request.contentKeyBundle.targets],
      },
      documentContainerManifestHistory: [
        ...revokedProjection.path,
        ...revokedProjection.containerKeks.flatMap(
          (kek) => kek.containerManifestHistory,
        ),
      ],
      documentId: createdDocument.plan.documentId,
      documentKekTargets: {
        documentId: createdDocument.plan.documentId,
        linkSetManifestHash: createdDocument.plan.manifestHash,
        linkedContainerManifestHashes: createdDocument.plan.targets.map(
          (target) => target.containerManifestHash,
        ),
        linkedContainerKeyEpochIds: createdDocument.plan.targets.map(
          (target) => target.containerKeyEpochId,
        ),
        targets: createdDocument.plan.targets.map((target) => ({ ...target })),
        documentKeyTargetHash: createdDocument.plan.targetHash,
      },
      documentManifest: {
        event: {
          event: createdDocument.plan.event as unknown as Record<
            string,
            unknown
          >,
          body: createdDocument.plan.body as unknown as Record<string, unknown>,
          eventHash: createdDocument.plan.eventHash,
        },
        manifest: createdDocument.plan.manifest as unknown as Record<
          string,
          unknown
        >,
        manifestHash: createdDocument.plan.manifestHash,
        state: createdDocument.plan.state as unknown as Record<string, unknown>,
      },
      documentManifestContainerPaths: [[...revokedProjection.path]],
      documentManifestHistory: [],
    };
    const blobId = "550e8400-e29b-41d4-a716-446655440701";
    const bindingId = "550e8400-e29b-41d4-a716-446655440702";
    const slotId = "preview-after-revoke";
    const blobContentKey = crypto.getRandomValues(new Uint8Array(32));
    const multipart = createMultipartBlobStageFixture({
      stageId: "stage-blob-after-revoke",
    });
    const uploadedBlob = await uploadDocumentAttachment({
      apiClient: {
        ...multipart,
        bindBlobAttachment: async (_blobId, request) => {
          const targets = request.contentKeyBundle.targets;
          const linkedContainerManifestHashes = [
            ...new Set(targets.map((target) => target.containerManifestHash)),
          ].sort();
          const linkedContainerKeyEpochIds = [
            ...new Set(targets.map((target) => target.containerKeyEpochId)),
          ].sort();
          if (!request.stagedBlob) {
            throw new Error("Expected staged blob request");
          }
          const blobAccessManifestHash = await computeBlobAccessManifestHash({
            version: 1,
            blobId,
            organizationId: parent.projection.organizationId,
            activeBindingIds: [bindingId],
            documentManifestHashes: [createdDocument.plan.manifestHash],
            linkedContainerManifestHashes,
            linkedContainerKeyEpochIds,
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
          });
          const writeHeaderHash = await computeWriteHeaderHash(
            request.stagedBlob.writeHeader as unknown as WriteHeader,
          );
          const blobKekTargets = {
            blobId,
            organizationId: parent.projection.organizationId,
            activeBindingIds: [bindingId],
            documentManifestHashes: [createdDocument.plan.manifestHash],
            linkedContainerManifestHashes,
            linkedContainerKeyEpochIds,
            targets: targets.map((target) => ({ ...target })),
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
            blobAccessManifestHash,
          };
          return {
            bindingId,
            bindingEvent: {
              body: request.body,
              event: request.event,
              eventHash: await computeAccessEventHash(
                request.event as unknown as AccessEvent,
              ),
            },
            blobId,
            documentId: createdDocument.plan.documentId,
            documentManifestHash: createdDocument.plan.manifestHash,
            previousBindingId: null,
            slotId,
            contentKeyBundle: {
              blobId,
              ...request.contentKeyBundle,
            },
            blobKekTargets,
            writeAuthorization: blobKekTargets,
            writeHeader: request.stagedBlob.writeHeader,
            writeHeaderHash,
          };
        },
        getDocumentWriterProjection: async (documentId) =>
          documentId === createdDocument.plan.documentId
            ? documentWriterProjection
            : null,
      },
      author: parent.author,
      bindingId,
      blobId,
      bytes: new Uint8Array([1, 2, 3, 4]) as BlobBytes,
      contentKey: blobContentKey,
      documentId: createdDocument.plan.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: SIGNED_AT,
      slotId,
      targetSecretKey: parent.secretKey,
    });
    if (!uploadedBlob) {
      throw new Error("Expected blob attachment upload");
    }
    const [blobTargetEnvelope] = uploadedBlob.request.contentKeyBundle.targets;
    if (!blobTargetEnvelope) {
      throw new Error("Expected blob content-key target");
    }
    const blobWrappingMetadata = blobTargetEnvelope.wrappingMetadata;
    if (
      !blobWrappingMetadata ||
      typeof blobWrappingMetadata !== "object" ||
      Array.isArray(blobWrappingMetadata)
    ) {
      throw new Error("Expected blob wrapping metadata");
    }
    const blobWrapSuite = Reflect.get(blobWrappingMetadata, "suite");
    const blobWrapIv = Reflect.get(blobWrappingMetadata, "iv");
    expect(blobWrapSuite).toBe(BLOB_CONTENT_KEY_WRAP_SUITE);
    if (typeof blobWrapIv !== "string" || blobWrapIv.length === 0) {
      throw new Error("Expected blob wrapping IV");
    }
    expect(blobTargetEnvelope).toEqual(
      expect.objectContaining({
        containerManifestHash: revokedManifest.manifestHash,
        containerKeyEpoch: 2,
        containerKeyEpochId: rotatedContainerKeyEpochId,
      }),
    );
    const blobWrap = {
      iv: base64ToBytes(blobWrapIv),
      ciphertext: base64ToBytes(blobTargetEnvelope.wrappedKey),
    };
    const blobSealedFor = {
      ...blobTargetEnvelope,
      kind: "Blob",
      objectId: blobId,
      contentKeyEpoch: uploadedBlob.request.contentKeyBundle.contentKeyEpoch,
    } as const;
    const ownerBlobContentKey = await unwrapContentKey(
      blobWrap,
      rotatedContainerKek,
      blobSealedFor,
    );
    expect(Array.from(ownerBlobContentKey)).toEqual(Array.from(blobContentKey));
    await expect(
      unwrapContentKey(blobWrap, previousContainerKek, blobSealedFor),
    ).rejects.toThrow();
  } finally {
    closeProjectionDb();
  }
});
