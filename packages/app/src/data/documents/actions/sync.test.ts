import { expect, test } from "bun:test";
import {
  type AccessEvent,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  generateKemSeedAndKeyPair,
  verifyWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  type DocumentSyncRequest,
  isDocumentSyncRequest,
} from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createContainerWriterProjectionFixture } from "../../../../test/helpers/createContainerWriterProjectionFixture";
import {
  buildMaterializedDocumentCreatePlan,
  buildMaterializedDocumentLinkSetMutationPlan,
} from "../documentRuntime";
import {
  createAuthor,
  createDeepNonCanonicalRecord,
  createLinkSetResponseFromRequest,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createPreparedUpdate,
  createResponse,
  createSyncFixture,
  createSyncResponse,
  projectionPathRecords,
} from "../documentTestFixtures";
import {
  buildDocumentSyncPlan,
  buildMaterializedDocumentSyncPlan,
  syncRemoteDocument,
} from "./sync";

interface ContentRecordFields {
  ciphertext?: unknown;
  contentRecordId?: unknown;
  iv?: unknown;
  nonceDomainHash?: unknown;
}

test("buildDocumentSyncPlan signs document write headers with the current access boundary", async () => {
  const { author, createResponse, projection, signingPublicKey } =
    await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    authorizingContainerPaths: [projectionPathRecords(projection)],
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [
      await createPreparedUpdate({
        checkpointKind: "fresh_baseline",
        signedAt: "2026-04-27T00:00:01.000Z",
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.documentManifest?.manifestHash).toBe(
    createResponse.accessManifest.manifestHash,
  );
  expect(plan.request.contentKeyBundle?.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
  expect(
    Reflect.get(
      plan.request.authorizingContainerPaths?.[0]?.[0] ?? {},
      "manifestHash",
    ),
  ).toBe(projection.path[0]?.manifestHash);
  const update = plan.request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected a signed outgoing update");
  }
  const writeHeader = update.writeHeader as unknown as WriteHeader;
  expect(writeHeader.objectKind).toBe("document");
  expect(writeHeader.objectId).toBe(plan.documentId);
  expect(writeHeader.organizationId).toBe(author.organizationId);
  expect(writeHeader.accessManifestHash).toBe(
    createResponse.accessManifest.manifestHash,
  );
  expect(writeHeader.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
  expect(writeHeader.encryptionSuite).toBe(CONTENT_RECORD_ENCRYPTION_SUITE);

  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: createResponse.accessManifest.manifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: plan.documentId,
      organizationId: author.organizationId,
    },
    expectedTargetHash: createResponse.contentKeyBundle.targetHash,
    header: writeHeader,
    writerPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);
});

test("buildDocumentSyncPlan omits write-only fields for read-only syncs", async () => {
  const { author, createResponse } = await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: "{}",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.outgoingUpdates).toEqual([]);
  expect(plan.request.documentManifest).toBeUndefined();
  expect(plan.request.authorizingContainerPaths).toBeUndefined();
  expect(plan.request.contentKeyBundle).toBeUndefined();
});

test("buildDocumentSyncPlan rejects manifest bundles whose state does not derive the manifest", async () => {
  const { author, createResponse, projection } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPaths: [projectionPathRecords(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        state: {
          ...createResponse.accessManifest.state,
          linkedContainerIds: [projection.containerId, "forged-container-link"],
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("manifest state mismatch");
});

test("buildDocumentSyncPlan rejects malformed manifest event envelopes before hashing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();
  const event = Reflect.get(createResponse.accessManifest.event, "event");
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Expected signed event fixture");
  }

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPaths: [projectionPathRecords(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        event: {
          ...createResponse.accessManifest.event,
          event: {
            ...(event as Record<string, unknown>),
            eventType: "document.move",
          },
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("signed event.eventType is invalid");
});

test("buildDocumentSyncPlan rejects deeply nested non-canonical manifest records without overflowing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPaths: [projectionPathRecords(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        event: {
          ...createResponse.accessManifest.event,
          event: {
            ...(Reflect.get(
              createResponse.accessManifest.event,
              "event",
            ) as Record<string, unknown>),
            unexpectedDeepValue: createDeepNonCanonicalRecord(20_000),
          },
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("must be canonical JSON");
});

test("buildDocumentSyncPlan rejects duplicate content record domains before signing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();
  const duplicateContentRecordId = "550e8400-e29b-41d4-a716-446655440333";

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPaths: [projectionPathRecords(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: createResponse.accessManifest,
      localVersionVector: null,
      outgoingUpdates: [
        await createPreparedUpdate({
          contentRecordId: duplicateContentRecordId,
          id: "550e8400-e29b-41d4-a716-446655440222",
        }),
        await createPreparedUpdate({
          contentRecordId: duplicateContentRecordId.toUpperCase(),
          id: "550e8400-e29b-41d4-a716-446655440223",
        }),
      ],
    }),
  ).rejects.toThrow("content record id is duplicated");
});

test("buildMaterializedDocumentSyncPlan unwraps the content key and encrypts pending updates", async () => {
  const { author, contentKey, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const plan = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        sourceVersionVector: "rotate-frontier",
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  expect(Array.from(plan.contentKey)).toEqual(Array.from(contentKey));
  expect(isDocumentSyncRequest(plan.plan.request)).toBe(true);
  const update = plan.plan.request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected materialized outgoing update");
  }
  expect(update.checkpointKind).toBe("rotate_baseline");
  expect(update.sourceVersionVector).toBe("rotate-frontier");
  expect(update.encryptedData).toContain("tearleads.document.loro-update");
  expect(update.encryptedData).not.toContain("materialized update");

  const writeHeader = update.writeHeader as unknown as WriteHeader;
  expect(writeHeader.contentRecordId).toBe(update.id);
  expect(writeHeader.ciphertextHash).toHaveLength(64);
  expect(writeHeader.metadataHash).toHaveLength(64);
  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: writerProjection.documentManifest.manifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: writerProjection.documentId,
      organizationId: author.organizationId,
    },
    expectedTargetHash: writerProjection.contentKeyBundle.targetHash,
    header: writeHeader,
    writerPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);
});

test("buildMaterializedDocumentSyncPlan rejects document writer projections with bad signatures", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "verified-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440099",
    eventId: "event-bad-document-signature",
    resolveProjectionUserKey: async (userId) =>
      userId === author.signerUserId
        ? {
            encapsulationPublicKey: encapsulationKeyPair.publicKey,
            signingPublicKey,
            userId,
          }
        : null,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    documentId: response.id,
    documentManifest: response.accessManifest,
    documentKekTargets: response.documentKekTargets,
    contentKeyBundle: response.contentKeyBundle,
    authorizingContainerPaths: [projection],
  };
  const signedEvent = writerProjection.documentManifest.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed document event fixture");
  }

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey: async (userId) =>
        userId === author.signerUserId
          ? {
              encapsulationPublicKey: encapsulationKeyPair.publicKey,
              signingPublicKey,
              userId,
            }
          : null,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection: {
        ...writerProjection,
        documentManifest: {
          ...writerProjection.documentManifest,
          event: {
            ...writerProjection.documentManifest.event,
            event: {
              ...signedEvent,
              signature: `${signature.slice(0, -1)}${
                signature.endsWith("A") ? "B" : "A"
              }`,
            },
          },
        },
      },
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
});

test("buildMaterializedDocumentSyncPlan verifies linked document manifest history", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const rootProjection = await createContainerWriterProjectionFixture({
    containerId: "verified-root-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const childProjection = await createContainerWriterProjectionFixture({
    containerId: "verified-child-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    parentProjection: rootProjection,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: rootProjection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440098",
    eventId: "event-verified-document-history",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(materializedCreate.plan);
  const initialWriterProjection: DocumentWriterProjectionResponse = {
    documentId: createdResponse.id,
    documentManifest: createdResponse.accessManifest,
    documentKekTargets: createdResponse.documentKekTargets,
    contentKeyBundle: createdResponse.contentKeyBundle,
    authorizingContainerPaths: [rootProjection],
  };
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    targetContainerProjection: childProjection,
    targetSecretKey: encapsulationKeyPair.secretKey,
    trustedLocalProjection: true,
    writerProjection: initialWriterProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    createdResponse.id,
    linked.plan.request,
  );
  const resolveProjectionUserKey = async (userId: string) =>
    userId === author.signerUserId
      ? {
          encapsulationPublicKey: encapsulationKeyPair.publicKey,
          signingPublicKey,
          userId,
        }
      : null;

  const syncPlan = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    writerProjection: {
      documentId: linkResponse.id,
      documentManifest: linkResponse.accessManifest,
      documentManifestHistory: [createdResponse.accessManifest],
      documentManifestContainerPaths: [
        rootProjection.path,
        childProjection.path,
      ],
      documentContainerManifestHistory: [
        ...rootProjection.path,
        ...childProjection.path,
      ],
      documentKekTargets: linkResponse.documentKekTargets,
      contentKeyBundle: linkResponse.contentKeyBundle,
      authorizingContainerPaths: [rootProjection, childProjection],
    },
  });

  expect(syncPlan.plan.documentManifest.manifestHash).toBe(
    linkResponse.accessManifest.manifestHash,
  );
});

test("buildMaterializedDocumentSyncPlan uses a fresh IV for same-domain re-encryption", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const sharedUpdate = createPendingUpdateRecord({
    updateData: bytesToBase64(new TextEncoder().encode("first payload")),
  });
  const first = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [sharedUpdate],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const second = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      {
        ...sharedUpdate,
        updateData: bytesToBase64(new TextEncoder().encode("second payload")),
      },
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const firstRecord = JSON.parse(
    first.plan.request.outgoingUpdates[0]?.encryptedData ?? "{}",
  ) as ContentRecordFields;
  const secondRecord = JSON.parse(
    second.plan.request.outgoingUpdates[0]?.encryptedData ?? "{}",
  ) as ContentRecordFields;

  expect(firstRecord.contentRecordId).toBe(sharedUpdate.id);
  expect(secondRecord.contentRecordId).toBe(sharedUpdate.id);
  expect(firstRecord.nonceDomainHash).toBe(secondRecord.nonceDomainHash);
  expect(firstRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(secondRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(firstRecord.iv).not.toBe(secondRecord.iv);
  expect(firstRecord.ciphertext).not.toBe(secondRecord.ciphertext);
});

test("syncRemoteDocument submits a signed sync request and persists the verified response", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async (documentId) =>
        documentId === writerProjection.documentId ? writerProjection : null,
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return createSyncResponse({
          ...materialized.plan,
          documentId,
          request,
        });
      },
    },
    author,
    documentId: writerProjection.documentId,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerPublicKeysByFingerprint: new Map([
      [author.signerKeyFingerprint, signingPublicKey],
    ]),
  });

  expect(submittedRequests).toHaveLength(1);
  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(synced?.response.acceptedOutgoingUpdateIds).toEqual([
    "550e8400-e29b-41d4-a716-446655440444",
  ]);
  expect(
    new TextDecoder().decode(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("materialized update");
});

test("syncRemoteDocument replans once after a stale document sync conflict", async () => {
  const {
    author,
    projection,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  const reportedErrors: string[] = [];
  let projectionRequestCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async (documentId) => {
        if (documentId !== writerProjection.documentId) {
          return null;
        }

        projectionRequestCount += 1;
        return writerProjection;
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle sync retries");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedRequests.push(request);

        if (submittedRequests.length === 1) {
          const message = `POST /documents/${documentId}/sync: 409 Conflict: authorizingContainerPaths[0][0] is stale`;
          return {
            message,
            ok: false,
            report: () => {
              reportedErrors.push(message);
            },
            status: 409,
          };
        }

        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          localVersionVector: null,
          pendingUpdates: [createPendingUpdateRecord()],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return {
          data: await createSyncResponse({
            ...materialized.plan,
            documentId,
            request,
          }),
          ok: true,
        };
      },
    },
    author,
    documentId: writerProjection.documentId,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerPublicKeysByFingerprint: new Map([
      [author.signerKeyFingerprint, signingPublicKey],
    ]),
  });

  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(projectionRequestCount).toBe(2);
  expect(submittedRequests).toHaveLength(2);
  expect(reportedErrors).toEqual([]);
  expect(
    Reflect.get(
      submittedRequests[1]?.authorizingContainerPaths?.[0]?.[0] ?? {},
      "manifestHash",
    ),
  ).toBe(projection.path[0]?.manifestHash);
});
