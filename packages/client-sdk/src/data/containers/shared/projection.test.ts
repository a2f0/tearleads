import { expect, test } from "bun:test";
import {
  type AccessEvent,
  BLOB_CONTENT_KEY_WRAP_SUITE,
  buildPrincipalStateSigningInput,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  computeAccessEventHash,
  computeBlobAccessManifestHash,
  computeContainerKekKeyringHash,
  computeContainerKekMaterialId,
  computeContainerKekPredecessorBridgeHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computePrincipalStateHash,
  computeWriteHeaderHash,
  createContainerKekPredecessorBridge,
  decryptWithDek,
  derivePrincipalRecipientKeyEpochId,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sealContainerKekKeyring,
  signPrincipalState,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  verifyContainerKekState,
  type WriteHeader,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql, type TestExecSql } from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { createMultipartBlobStageFixture } from "../../../../test/helpers/blobUploadFixtures";
import {
  createContainerManifestFixture,
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
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../../persistence/principalPolicyPersistence";

async function createGroupPrincipalPolicyBundle(input: {
  memberRecipientPublicKeys: Array<{
    userId: string;
    publicKey: Uint8Array;
  }>;
  members: Array<{ userId: string }>;
  principalId: string;
  principalKem: {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  };
  signedAt: string;
  signer: {
    recipientPublicKey: Uint8Array;
    signerKeyFingerprint: string;
    signerPrivateKey: Uint8Array;
    signerUserId: string;
  };
}): Promise<PrincipalPolicyBundleResponse> {
  const currentProjection = [
    {
      userId: input.signer.signerUserId,
      role: "admin" as const,
    },
    ...input.members.map((member) => ({
      userId: member.userId,
      role: "member" as const,
    })),
  ];
  const payloadCiphertext = `${input.principalId}-payload`;
  const recipients = [
    {
      userId: input.signer.signerUserId,
      publicKey: input.signer.recipientPublicKey,
    },
    ...input.memberRecipientPublicKeys,
  ];
  const wrappedMembers = await wrapDekForRecipients(
    input.principalKem.secretKey,
    recipients.map((recipient) => recipient.publicKey),
  );
  const memberEnvelopes = recipients.map((recipient, index) => {
    const wrappedMember = wrappedMembers[index];
    if (!wrappedMember) {
      throw new Error("Expected wrapped principal member key");
    }

    return {
      userId: recipient.userId,
      memberKeyFingerprint: wrappedMember.keyFingerprint,
      kemCipherText: bytesToBase64(wrappedMember.kemCipherText),
      wrappedKey: bytesToBase64(wrappedMember.wrappedKey),
    };
  });
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: input.principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(input.principalKem.publicKey),
      keyFingerprint: await toFingerprint(input.principalKem.publicKey),
      members: currentProjection.map((member) => ({ userId: member.userId })),
      memberEnvelopes,
      projection: currentProjection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: input.signedAt,
      signerUserId: input.signer.signerUserId,
      signerUserKeyFingerprint: input.signer.signerKeyFingerprint,
    }),
    input.signer.signerPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(signedState);

  return {
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: input.principalId,
      stateHash,
      epoch: 1,
      envelopes: memberEnvelopes,
    },
    currentPayload: {
      principalType: "group",
      principalId: input.principalId,
      stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: signedState.payloadCiphertextHash,
      createdAt: input.signedAt,
    },
    currentGrants: [],
    currentProjection,
    currentState: {
      ...signedState,
      createdAt: input.signedAt,
      stateHash,
    },
    previousStates: [],
  };
}

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
        "Container writer projection path[1] previous manifest manifest verification failed",
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
    const createdDocument = await buildMaterializedDocumentCreatePlan({
      author: parent.author,
      containerProjection: revokedProjection,
      contentKey,
      documentId: "550e8400-e29b-41d4-a716-446655440700",
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
    const ownerContentKey = await unwrapDocumentContentKeyTarget({
      containerKek: rotatedContainerKek,
      envelope: targetEnvelope,
    });
    expect(Array.from(ownerContentKey)).toEqual(Array.from(contentKey));
    await expect(
      unwrapDocumentContentKeyTarget({
        containerKek: previousContainerKek,
        envelope: targetEnvelope,
      }),
    ).rejects.toThrow();
    const documentWriterProjection: DocumentWriterProjectionResponse = {
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
    const ownerBlobContentKey = await decryptWithDek(
      {
        iv: base64ToBytes(blobWrapIv),
        ciphertext: base64ToBytes(blobTargetEnvelope.wrappedKey),
      },
      rotatedContainerKek,
    );
    expect(Array.from(ownerBlobContentKey)).toEqual(Array.from(blobContentKey));
    await expect(
      decryptWithDek(
        {
          iv: base64ToBytes(blobWrapIv),
          ciphertext: base64ToBytes(blobTargetEnvelope.wrappedKey),
        },
        previousContainerKek,
      ),
    ).rejects.toThrow();
  } finally {
    closeProjectionDb();
  }
});

test("unwrapContainerKekPath verifies cached group policies before managed-principal unwrap", async () => {
  const parent = await createParentProjection();
  const groupKem = generateKemSeedAndKeyPair();
  const groupMemberKem = generateKemSeedAndKeyPair();
  const groupMemberUserId = "group-member-user";
  const groupBundle = await createGroupPrincipalPolicyBundle({
    memberRecipientPublicKeys: [
      {
        userId: groupMemberUserId,
        publicKey: groupMemberKem.publicKey,
      },
    ],
    members: [{ userId: groupMemberUserId }],
    principalId: "group-managed-container-access",
    principalKem: groupKem,
    signedAt: SIGNED_AT,
    signer: {
      ...parent.author,
      recipientPublicKey: parent.encapsulationPublicKey,
    },
  });
  const groupHead = {
    principalType: "group" as const,
    principalId: groupBundle.currentState.principalId,
    version: groupBundle.currentState.version,
    keyEpoch: groupBundle.currentState.keyEpoch,
    stateHash: groupBundle.currentState.stateHash,
    keyFingerprint: groupBundle.currentState.keyFingerprint,
  };
  const containerId = "managed-group-container";
  const containerKek = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial: containerKek,
  });
  const manifest = await createContainerManifestFixture({
    author: parent.author,
    containerId,
    containerKeyEpochId,
    directGrants: [
      {
        subjectType: "group",
        subjectId: groupHead.principalId,
        accessLevel: "write",
      },
      {
        subjectType: "user",
        subjectId: parent.userId,
        accessLevel: "admin",
      },
    ],
    eventId: "managed-group-container-event-1",
    metadataDocumentId: "managed-group-container-metadata-document",
    organizationId: parent.projection.organizationId,
    referencedPrincipalHeads: [groupHead],
    signingPublicKey: parent.signingPublicKey,
  });
  const signerRecipientKeyFingerprint = await toFingerprint(
    parent.encapsulationPublicKey,
  );
  const signerRecipientKeyEpochId = `user:${parent.userId}:encapsulation:${signerRecipientKeyFingerprint}`;
  const signerWrap = await createUserContainerWrap({
    containerKeyEpochId,
    containerKek,
    publicKey: parent.encapsulationPublicKey,
    recipientKeyEpochId: signerRecipientKeyEpochId,
    userId: parent.userId,
    wrapManifestHash: manifest.manifestHash,
  });
  const [groupWrappedKek] = await wrapDekForRecipients(containerKek, [
    groupKem.publicKey,
  ]);
  if (!groupWrappedKek) {
    throw new Error("Expected wrapped group KEK");
  }
  const groupRecipientTarget: ContainerKekRecipientTarget = {
    recipientKind: "group",
    recipientId: groupHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(groupHead),
    recipientKeyFingerprint: groupWrappedKek.keyFingerprint,
  };
  const userRecipientTarget: ContainerKekRecipientTarget = {
    recipientKind: "user",
    recipientId: parent.userId,
    recipientKeyEpochId: signerRecipientKeyEpochId,
    recipientKeyFingerprint: signerWrap.recipientKeyFingerprint,
  };
  const recipientTargets = [groupRecipientTarget, userRecipientTarget];
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId,
    keyEpoch: 1,
    accessManifestHash: manifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: manifest.event.eventHash,
    createdByManifestHash: manifest.manifestHash,
  };
  const projection: ContainerWriterProjectionResponse = {
    containerId,
    organizationId: parent.projection.organizationId,
    path: [
      manifest as unknown as ContainerWriterProjectionResponse["path"][number],
    ],
    containerKeks: [
      {
        accessManifestHash: manifest.manifestHash,
        containerId,
        containerKeyEpoch: 1,
        containerKeyEpochId,
        keyEpoch: keyEpoch as unknown as Record<string, unknown>,
        keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
        keyTargetHash:
          await computeContainerKekRecipientTargetHash(recipientTargets),
        parentContainerKeyEpochId: null,
        containerManifestHistory: [],
        keyring: null,
        recipientTargets: recipientTargets as unknown as Record<
          string,
          unknown
        >[],
        wraps: [
          signerWrap,
          {
            containerKeyEpochId,
            recipientKind: "group",
            recipientId: groupHead.principalId,
            recipientKeyEpochId: groupRecipientTarget.recipientKeyEpochId,
            recipientKeyFingerprint: groupWrappedKek.keyFingerprint,
            kemCipherText: bytesToBase64(groupWrappedKek.kemCipherText),
            wrappedKey: bytesToBase64(groupWrappedKek.wrappedKey),
            wrapManifestHash: manifest.manifestHash,
          },
        ],
      },
    ],
  };
  const resolveProjectionUserKey =
    createParentProjectionUserKeyResolver(parent);
  const { close, execSql } = await createTestExecSql(
    "managed-principal-projection-verification",
  );

  try {
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      groupBundle,
      "2026-04-28T12:01:00.000Z",
    );

    const groupMemberKeks = await unwrapContainerKekPath({
      execSql,
      projection,
      resolveProjectionUserKey,
      secretKey: groupMemberKem.secretKey,
    });

    expect(Array.from(groupMemberKeks.get(containerKeyEpochId) ?? [])).toEqual(
      Array.from(containerKek),
    );
  } finally {
    close();
  }
});

test("unwrapContainerKekPath fails closed for managed-principal KEK projections", async () => {
  const parent = await createParentProjection();
  const groupHead = {
    principalType: "group" as const,
    principalId: "group-1",
    version: 1,
    keyEpoch: 1,
    stateHash: await toFingerprint(new TextEncoder().encode("group-state-1")),
    keyFingerprint: await toFingerprint(
      new TextEncoder().encode("group-key-1"),
    ),
  };
  const managedManifest = await createContainerManifestFixture({
    author: parent.author,
    containerId: parent.parentKekState.containerId,
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: parent.userId,
        accessLevel: "admin",
      },
      {
        subjectType: "group",
        subjectId: groupHead.principalId,
        accessLevel: "write",
      },
    ],
    eventId: "managed-parent-container-event-1",
    metadataDocumentId: "parent-container-metadata-document",
    organizationId: parent.projection.organizationId,
    referencedPrincipalHeads: [groupHead],
    signingPublicKey: parent.signingPublicKey,
  });
  const managedProjection: ContainerWriterProjectionResponse = {
    ...parent.projection,
    path: [
      managedManifest as unknown as ContainerWriterProjectionResponse["path"][number],
    ],
  };

  await withProjectionDatabase(
    "projection-missing-group-policy",
    async (execSql) =>
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: managedProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow("Principal policy group:group-1@1 is not cached"),
  );
});
