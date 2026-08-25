import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  type AccessEvent,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  generateKemSeedAndKeyPair,
  verifyWriteHeader,
  type WriteHeader,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  exportAllUpdates,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@symcrypt/loro";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@symcrypt/test-utils";
import {
  type DocumentSyncRequest,
  isDocumentSyncRequest,
} from "@symcrypt/validators/request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
  substituteFirstProjectionUserWrapMaterial,
} from "../../../test/helpers/containerFixtures";
import {
  createAuthor,
  createDeepNonCanonicalRecord,
  createLinkSetResponseFromRequest,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createPreparedUpdate,
  createResponse,
  createSignedSyncResponseUpdate,
  createSyncFixture,
  createSyncResponse,
  projectionPathRefs,
  writerKeyResolver,
  writerProjectionEvidence,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import {
  createFullHistoryRotationSnapshot,
  createStaleBundleSyncFixture,
} from "../../../test/helpers/staleBundleSyncFixture";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { persistedDocumentSyncStateFromResponse } from "../../data/documents/shared/syncResponses";
import { ensureDocumentTables } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  buildMaterializedDocumentCreatePlan,
  buildMaterializedDocumentLinkSetMutationPlan,
} from "./index";
import { hasDocumentUpdateEvent } from "./sync";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql("document-sync"));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

interface ContentRecordFields {
  ciphertext?: unknown;
  contentRecordId?: unknown;
  iv?: unknown;
  nonceDomainHash?: unknown;
}

function persistedStateFromWriterProjection(
  writerProjection: DocumentWriterProjectionResponse,
) {
  return {
    documentId: writerProjection.documentId,
    contentKeyBundle: JSON.stringify(writerProjection.contentKeyBundle),
    documentKekTargets: JSON.stringify(writerProjection.documentKekTargets),
    documentManifestBundle: JSON.stringify(writerProjection.documentManifest),
  };
}

async function createLoroPendingUpdate(text: string, id?: string) {
  const doc = await createDocument(`sync-fixture:${text}`);
  doc.getText("text").update(text);
  doc.commit();
  const update = exportAllUpdates(doc);
  const vectors = getUpdateVersionVectors(update);
  return createPendingUpdateRecord({
    ...(id === undefined ? {} : { id }),
    updateData: bytesToBase64(update),
    ...vectors,
  });
}

async function decryptedUpdateText(
  update: Uint8Array | null | undefined,
): Promise<string> {
  if (!update) {
    throw new Error("Expected a decrypted Loro update");
  }
  const reader = await createDocument("sync-test-reader");
  importUpdates(reader, [update]);
  return getTextValue(reader);
}

test("hasDocumentUpdateEvent detects matching document update events", () => {
  expect(
    hasDocumentUpdateEvent(
      [
        {
          documentId: "document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      "document-1",
    ),
  ).toBe(true);
  expect(
    hasDocumentUpdateEvent(
      [
        {
          documentId: "document-2",
          id: "event-2",
          type: "document_update_created",
        },
      ],
      "document-1",
    ),
  ).toBe(false);
  expect(
    hasDocumentUpdateEvent(
      [
        {
          documentId: "document-1",
          id: "event-3",
          type: "other_event",
        },
      ],
      "document-1",
    ),
  ).toBe(false);
  expect(
    hasDocumentUpdateEvent(
      [
        {
          documentId: "document-1",
          id: "event-4",
          type: "document_update_created",
        },
      ],
      null,
    ),
  ).toBe(false);
});

test("buildDocumentSyncPlan signs document write headers with the current access boundary", async () => {
  const { author, createResponse, projection, signingPublicKey } =
    await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    authorizingContainerPathRefs: [projectionPathRefs(projection)],
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [
      await createPreparedUpdate({
        checkpointKind: "rotate_baseline",
        signedAt: "2026-04-27T00:00:01.000Z",
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.supportsUntrackedCommitLsn).toBe(true);
  // The server resolves the signed manifest bundle by hash.
  expect(plan.request.expectedLinkSetManifestHash).toBe(
    createResponse.accessManifest.manifestHash,
  );
  expect(plan.request.contentKeyBundle?.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
  expect(
    plan.request.authorizingContainerPathRefs?.[0]?.[0]?.manifestHash,
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
  expect(plan.request.historyMode).toBeUndefined();
  expect(plan.request.authorizingContainerPathRefs).toBeUndefined();
  expect(plan.request.contentKeyBundle).toBeUndefined();
});

test("buildDocumentSyncPlan creates a read-only resumed pull", async () => {
  const { author, createResponse } = await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: null,
    pullCursor: "resume-page-2",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.pullCursor).toBe("resume-page-2");
  expect(plan.request.outgoingUpdates).toEqual([]);
  expect(plan.request.authorizingContainerPathRefs).toBeUndefined();
  expect(plan.request.contentKeyBundle).toBeUndefined();
});

test("buildDocumentSyncPlan rejects manifest bundles whose state does not derive the manifest", async () => {
  const { author, createResponse, projection } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPathRefs: [projectionPathRefs(projection)],
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
      authorizingContainerPathRefs: [projectionPathRefs(projection)],
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
      authorizingContainerPathRefs: [projectionPathRefs(projection)],
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
      authorizingContainerPathRefs: [projectionPathRefs(projection)],
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
    execSql,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: encapsulationKeyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    documentId: response.id,
    documentManifest: response.accessManifest,
    ...writerProjectionEvidence([projection], []),
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
      execSql,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey,
        userId: author.signerUserId,
      }),
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

test("buildMaterializedDocumentSyncPlan rejects substituted KEK material before encrypting updates", async () => {
  const parent = await createParentProjection();
  const resolveProjectionUserKey =
    createParentProjectionUserKeyResolver(parent);
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440111",
    eventId: "event-substituted-kek-sync",
    execSql,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: parent.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const tamperedProjection = await substituteFirstProjectionUserWrapMaterial({
    projection: parent.projection,
    publicKey: parent.encapsulationPublicKey,
    userId: parent.userId,
  });
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [tamperedProjection],
    contentKeyBundle: response.contentKeyBundle,
    ...writerProjectionEvidence([tamperedProjection], []),
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifest: response.accessManifest,
  };

  await expect(
    buildMaterializedDocumentSyncPlan({
      author: parent.author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey,
      targetSecretKey: parent.secretKey,
      writerProjection,
    }),
  ).rejects.toThrow("KEK material does not match committed epoch id");
});

// Regression for sharing manifest verification across the consistency and
// content-key unwrap passes (issue #1040 / scrub finding #5).
test("buildMaterializedDocumentSyncPlan verifies each authorizing path once across both passes", async () => {
  const parent = await createParentProjection();
  const baseResolver = createParentProjectionUserKeyResolver(parent);
  let signerKeyResolutions = 0;
  const countingResolver = async (userId: string) => {
    signerKeyResolutions += 1;
    return baseResolver(userId);
  };

  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440122",
    eventId: "event-single-verify-sync",
    execSql,
    resolveProjectionUserKey: countingResolver,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: parent.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [parent.projection],
    contentKeyBundle: response.contentKeyBundle,
    ...writerProjectionEvidence([parent.projection], []),
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifest: response.accessManifest,
  };

  signerKeyResolutions = 0;
  await buildMaterializedDocumentSyncPlan({
    author: parent.author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey: countingResolver,
    targetSecretKey: parent.secretKey,
    writerProjection,
  });

  // With the shared verification cache the unwrap pass reuses the consistency
  // pass's verified container manifests instead of re-verifying them. For this
  // fixture that lowers signer-key resolutions from 5 (un-cached two-pass build)
  // to 4; the saving grows with container-path depth, where the same manifests
  // recur across passes. Pinning the count guards against the cache threading
  // being dropped (which would push this back to 5).
  expect(signerKeyResolutions).toBe(4);
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
    ...writerProjectionEvidence([rootProjection], []),
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
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection: {
        documentId: linkResponse.id,
        documentManifest: linkResponse.accessManifest,
        ...writerProjectionEvidence([rootProjection, childProjection], []),
        documentKekTargets: linkResponse.documentKekTargets,
        contentKeyBundle: linkResponse.contentKeyBundle,
        authorizingContainerPaths: [rootProjection, childProjection],
      },
    }),
  ).rejects.toThrow("Document writer projection previous manifest");

  const syncPlan = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
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
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection fetch");
      },
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
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
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(submittedRequests).toHaveLength(1);
  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(synced?.response.acceptedOutgoingUpdateIds).toEqual([
    "550e8400-e29b-41d4-a716-446655440444",
  ]);
  expect(synced?.settledPendingUpdateIds).toEqual([
    "550e8400-e29b-41d4-a716-446655440444",
  ]);
  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("materialized update");
});

test("syncRemoteDocument uses persisted state for clean read-only sync probes", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  let projectionRequestCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async (documentId) => {
        if (documentId === writerProjection.documentId) {
          projectionRequestCount += 1;
        }
        return writerProjection;
      },
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const plan = await buildDocumentSyncPlan({
          author,
          contentKeyBundle: writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: writerProjection.documentKekTargets,
          documentManifest: writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse({
          ...plan,
          documentId,
          request,
        });
      },
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [],
    persistedState: persistedStateFromWriterProjection(writerProjection),
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  expect(projectionRequestCount).toBe(0);
  expect(submittedRequests).toHaveLength(1);
  expect(submittedRequests[0]?.outgoingUpdates).toEqual([]);
  expect(synced?.decryptedUpdates).toEqual([]);
  expect(synced?.settledPendingUpdateIds).toEqual([]);
  expect(synced?.writerProjection).toBeUndefined();
});

test("syncRemoteDocument reuses a writer projection to process persisted read-only response updates", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const remoteMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const remoteResponse = await createSyncResponse(remoteMaterialized.plan);
  const remoteUpdate = remoteResponse.updates[0];
  if (!remoteUpdate) {
    throw new Error("Expected remote update fixture");
  }

  const submittedRequests: DocumentSyncRequest[] = [];
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
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const readOnlyPlan = await buildDocumentSyncPlan({
          author,
          contentKeyBundle: writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: writerProjection.documentKekTargets,
          documentManifest: writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse(
          {
            ...readOnlyPlan,
            documentId,
            request,
          },
          {
            acceptedOutgoingUpdateIds: [],
            updates: [remoteUpdate],
          },
        );
      },
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [],
    persistedState: persistedStateFromWriterProjection(writerProjection),
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(projectionRequestCount).toBe(0);
  expect(submittedRequests).toHaveLength(1);
  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("materialized update");
});

test("syncRemoteDocument falls back to writer projection when persisted read-only state is stale", async () => {
  const {
    author,
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
          const message = "Document content-key bundle is stale";
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
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
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
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
    execSql,
    localVersionVector: null,
    pendingUpdates: [],
    persistedState: persistedStateFromWriterProjection(writerProjection),
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(projectionRequestCount).toBe(1);
  expect(submittedRequests).toHaveLength(2);
  expect(reportedErrors).toEqual([]);
});

test("syncRemoteDocument decrypts returned updates with historical content-key bundles", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const historicalMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [await createLoroPendingUpdate("historical update")],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const historicalResponse = await createSyncResponse(
    historicalMaterialized.plan,
  );
  const historicalUpdate = historicalResponse.updates[0];
  if (!historicalUpdate) {
    throw new Error("Expected historical update fixture");
  }
  const currentWriterProjection: DocumentWriterProjectionResponse = {
    ...writerProjection,
    contentKeyBundle: {
      ...writerProjection.contentKeyBundle,
      contentKeyEpoch: writerProjection.contentKeyBundle.contentKeyEpoch + 1,
    },
  };
  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async (documentId) =>
        documentId === currentWriterProjection.documentId
          ? currentWriterProjection
          : null,
      syncDocument: async (documentId, request) => {
        const currentMaterialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection: currentWriterProjection,
        });
        return createSyncResponse(
          {
            ...currentMaterialized.plan,
            documentId,
            request,
          },
          {
            contentKeyBundles: [
              writerProjection.contentKeyBundle,
              currentWriterProjection.contentKeyBundle,
            ],
            updates: [historicalUpdate],
          },
        );
      },
    },
    author,
    documentId: currentWriterProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("historical update");
});

test("document sync rejects an incoming update from a read-only writer", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
  });
  const { author: ungrantedWriter, signingPublicKey } = await createAuthor();
  ungrantedWriter.signerUserId = "read-only-writer";
  const update = await createSignedSyncResponseUpdate({
    accessManifestHash: materialized.plan.expectedLinkSetManifestHash,
    author: ungrantedWriter,
    plan: materialized.plan,
    targetHash: materialized.plan.expectedTargetHash,
  });

  await expect(
    persistedDocumentSyncStateFromResponse(
      materialized.plan,
      await createSyncResponse(materialized.plan, {
        acceptedOutgoingUpdateIds: [],
        updates: [update],
      }),
      {
        resolveWriterPublicKey: async () => signingPublicKey,
      },
    ),
  ).rejects.toThrow("signer lacks write access");
});

test("document sync rejects substituted writer-authorization targets", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const update = response.updates[0];
  const target = update?.authorizationTargets?.[0];
  if (!update || !target) {
    throw new Error("Expected writer-authorization target fixture");
  }

  await expect(
    persistedDocumentSyncStateFromResponse(
      materialized.plan,
      {
        ...response,
        updates: [
          {
            ...update,
            authorizationTargets: [
              { ...target, containerManifestHash: "0".repeat(64) },
            ],
          },
        ],
      },
      { resolveWriterPublicKey: async () => signingPublicKey },
    ),
  ).rejects.toThrow("write targets are not canonical");
});

test("syncRemoteDocument recovers pending write id conflicts with a read-only sync", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const pendingUpdate = await createLoroPendingUpdate("settled update");
  const historicalMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const historicalResponse = await createSyncResponse(
    historicalMaterialized.plan,
  );
  const historicalUpdate = historicalResponse.updates[0];
  if (!historicalUpdate) {
    throw new Error("Expected historical update fixture");
  }
  const currentWriterProjection: DocumentWriterProjectionResponse = {
    ...writerProjection,
    contentKeyBundle: {
      ...writerProjection.contentKeyBundle,
      contentKeyEpoch: writerProjection.contentKeyBundle.contentKeyEpoch + 1,
    },
  };
  const submittedOutgoingCounts: number[] = [];
  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async (documentId) =>
        documentId === currentWriterProjection.documentId
          ? currentWriterProjection
          : null,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedOutgoingCounts.push(request.outgoingUpdates.length);
        if (submittedOutgoingCounts.length === 1) {
          const message = `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`;
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message,
            ok: false,
            report: () => undefined,
            status: 409,
          };
        }

        const currentMaterialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection: currentWriterProjection,
        });
        return {
          data: await createSyncResponse(
            {
              ...currentMaterialized.plan,
              documentId,
              request,
            },
            {
              contentKeyBundles: [
                writerProjection.contentKeyBundle,
                currentWriterProjection.contentKeyBundle,
              ],
              updates: [historicalUpdate],
            },
          ),
          ok: true,
        };
      },
    },
    author,
    documentId: currentWriterProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(submittedOutgoingCounts).toEqual([1, 0]);
  expect(synced?.response.acceptedOutgoingUpdateIds).toEqual([]);
  expect(synced?.settledPendingUpdateIds).toEqual([pendingUpdate.id]);
  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("settled update");
});

test("syncRemoteDocument does not settle recovered pending conflicts with different content", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const pendingUpdate = await createLoroPendingUpdate("local update");
  const remoteUpdate = await createLoroPendingUpdate(
    "remote update",
    pendingUpdate.id,
  );
  const historicalMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [remoteUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const historicalResponse = await createSyncResponse(
    historicalMaterialized.plan,
  );
  const historicalUpdate = historicalResponse.updates[0];
  if (!historicalUpdate) {
    throw new Error("Expected historical update fixture");
  }
  const currentWriterProjection: DocumentWriterProjectionResponse = {
    ...writerProjection,
    contentKeyBundle: {
      ...writerProjection.contentKeyBundle,
      contentKeyEpoch: writerProjection.contentKeyBundle.contentKeyEpoch + 1,
    },
  };
  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => currentWriterProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId, request) => {
        if (request.outgoingUpdates.length > 0) {
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
            ok: false,
            report: () => undefined,
            status: 409,
          };
        }

        const currentMaterialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection: currentWriterProjection,
        });
        return {
          data: await createSyncResponse(
            {
              ...currentMaterialized.plan,
              documentId,
              request,
            },
            {
              contentKeyBundles: [
                writerProjection.contentKeyBundle,
                currentWriterProjection.contentKeyBundle,
              ],
              updates: [historicalUpdate],
            },
          ),
          ok: true,
        };
      },
    },
    author,
    documentId: currentWriterProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(synced?.settledPendingUpdateIds).toEqual([]);
  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("remote update");
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
          const message = `POST /documents/${documentId}/sync: 409 Conflict: authorizingContainerPathRefs[0][0] is stale`;
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
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
          execSql,
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
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(projectionRequestCount).toBe(2);
  expect(submittedRequests).toHaveLength(2);
  expect(reportedErrors).toEqual([]);
  expect(
    submittedRequests[1]?.authorizingContainerPathRefs?.[0]?.[0]?.manifestHash,
  ).toBe(projection.path[0]?.manifestHash);
});

function writeHeaderEpoch(update: { writeHeader: Record<string, unknown> }) {
  return Reflect.get(update.writeHeader, "contentKeyEpoch");
}

test("buildMaterializedDocumentSyncPlan heals a stale bundle with a fresh key and rotation baseline", async () => {
  const fixture = await createStaleBundleSyncFixture();
  const pendingUpdate = await createLoroPendingUpdate("stale heal edit");

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: createFullHistoryRotationSnapshot,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  expect(materialized.healedStaleContentKeyBundle).toBe(true);
  expect(materialized.contentKey).toHaveLength(32);
  expect(materialized.contentKey).not.toEqual(fixture.contentKey);

  const { request } = materialized.plan;
  expect(request.contentKeyEpoch).toBe(fixture.staleBundle.contentKeyEpoch + 1);
  expect(request.contentKeyBundle?.contentKeyEpoch).toBe(
    fixture.staleBundle.contentKeyEpoch + 1,
  );
  expect(request.expectedTargetHash).toBe(
    fixture.staleWriterProjection.documentKekTargets.documentKeyTargetHash,
  );
  expect(request.contentKeyBundle?.targets[0]?.containerKeyEpochId).toBe(
    fixture.rotatedTarget.containerKeyEpochId,
  );
  expect(request.contentKeyBundle?.targets[0]?.wrappedKey).not.toBe(
    fixture.staleBundle.targets[0]?.wrappedKey,
  );
  // The covering baseline optimizes current-epoch redirects; predecessor KEKs
  // remain the no-baseline path. The queued update uses the fresh key.
  expect(request.outgoingUpdates).toHaveLength(2);
  expect(request.outgoingUpdates[0]?.checkpointKind).toBe("rotate_baseline");
  expect(request.outgoingUpdates[1]?.id).toBe(pendingUpdate.id);
  for (const update of request.outgoingUpdates) {
    expect(writeHeaderEpoch(update)).toBe(
      fixture.staleBundle.contentKeyEpoch + 1,
    );
  }
});

test("a read-only stale bundle degrades when its target predates the current path", async () => {
  const fixture = await createStaleBundleSyncFixture();

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [],
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  expect(materialized.healedStaleContentKeyBundle).toBe(false);
  expect(materialized.contentKey).toHaveLength(0);
  const { plan } = materialized;
  expect(plan.request.contentKeyBundle).toBeUndefined();
  expect(plan.request.contentKeyEpoch).toBe(
    fixture.staleBundle.contentKeyEpoch,
  );
  expect(plan.request.expectedTargetHash).toBe(fixture.staleBundle.targetHash);
  expect(plan.documentKekTargets.documentKeyTargetHash).toBe(
    fixture.staleBundle.targetHash,
  );
});

test("buildMaterializedDocumentSyncPlan refuses to heal without a rotation snapshot", async () => {
  const fixture = await createStaleBundleSyncFixture();

  await expect(
    buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      localVersionVector: null,
      pendingUpdates: [await createLoroPendingUpdate("stuck edit")],
      signedAt: "2026-07-26T00:00:00.000Z",
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.staleWriterProjection,
    }),
  ).rejects.toThrow(
    "Document content-key bundle is stale and no rotation snapshot is available to heal it",
  );
});

test("consumers that cannot heal reject a stale content-key bundle outright", async () => {
  const fixture = await createStaleBundleSyncFixture();

  await expect(
    assertDocumentWriterProjectionConsistent(fixture.staleWriterProjection, {
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("Document writer projection content-key bundle is stale");
});

test("a heal holds back superseded pending rotation checkpoints it provably covers", async () => {
  const fixture = await createStaleBundleSyncFixture();
  // One live document backs the queued edit, the leftover checkpoint, AND the
  // recovery snapshot — exactly how the stores wire buildRotationSnapshot.
  const doc = await createDocument("held-back-checkpoint-source");
  doc.getText("text").update("stale heal edit");
  doc.commit();
  const editUpdate = exportAllUpdates(doc);
  const editVectors = getUpdateVersionVectors(editUpdate);
  const pendingEdit = createPendingUpdateRecord({
    updateData: bytesToBase64(editUpdate),
    ...editVectors,
  });
  const supersededCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440777",
    sourceVersionVector: editVectors.partialEndVersionVector,
    updateData: bytesToBase64(exportFullHistorySnapshot(doc)),
    partialStartVersionVector: "{}",
    partialEndVersionVector: editVectors.partialEndVersionVector,
  });

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(doc),
    localVersionVector: null,
    pendingUpdates: [supersededCheckpoint, pendingEdit],
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  expect(materialized.healedStaleContentKeyBundle).toBe(true);
  const { request } = materialized.plan;
  // Fresh covering baseline + the ordinary edit; the covered checkpoint is
  // withheld — submitting it would trip the server's covering-baseline gate,
  // and resubmitting it post-heal could mask the covering baseline.
  expect(request.outgoingUpdates).toHaveLength(2);
  expect(request.outgoingUpdates[0]?.checkpointKind).toBe("rotate_baseline");
  expect(request.outgoingUpdates.map((update) => update.id)).not.toContain(
    supersededCheckpoint.id,
  );
  expect(request.outgoingUpdates[1]?.id).toBe(pendingEdit.id);
  // The plan reports what it withheld (settled by the heal, since the
  // baseline subsumes it) and which ack is synthetic.
  expect(materialized.heldBackPendingUpdateIds).toEqual([
    supersededCheckpoint.id,
  ]);
  expect(materialized.staleRecoveryBaselineUpdateId).toBe(
    request.outgoingUpdates[0]?.id ?? "",
  );
});

test("a heal refuses to settle a checkpoint its snapshot does not cover", async () => {
  const fixture = await createStaleBundleSyncFixture();
  // The checkpoint's ops come from a document the recovery snapshot has never
  // seen — settling it would silently drop those ops.
  const foreignEdit = await createLoroPendingUpdate("foreign checkpoint ops");
  const uncoveredCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440888",
    sourceVersionVector: foreignEdit.partialEndVersionVector,
    updateData: foreignEdit.updateData,
    partialStartVersionVector: "{}",
    partialEndVersionVector: foreignEdit.partialEndVersionVector,
  });

  await expect(
    buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      localVersionVector: null,
      pendingUpdates: [
        uncoveredCheckpoint,
        await createLoroPendingUpdate("stuck edit"),
      ],
      signedAt: "2026-07-26T00:00:00.000Z",
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.staleWriterProjection,
    }),
  ).rejects.toThrow(
    "Document stale-bundle recovery snapshot does not cover a queued rotation checkpoint",
  );
});

test("regeneration replaces queued checkpoints with a fresh covering baseline", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const doc = await createDocument("leftover-checkpoint-regenerate");
  doc.getText("text").update("history behind the checkpoint");
  doc.commit();
  const editUpdate = exportAllUpdates(doc);
  const editVectors = getUpdateVersionVectors(editUpdate);
  const pendingEdit = createPendingUpdateRecord({
    updateData: bytesToBase64(editUpdate),
    ...editVectors,
  });
  const leftoverCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440aaa",
    sourceVersionVector: editVectors.partialEndVersionVector,
    updateData: bytesToBase64(exportFullHistorySnapshot(doc)),
    partialStartVersionVector: "{}",
    partialEndVersionVector: editVectors.partialEndVersionVector,
  });

  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(doc),
    localVersionVector: null,
    pendingUpdates: [leftoverCheckpoint, pendingEdit],
    regenerateQueuedCheckpoints: true,
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  // The stale leftover is replaced by one fresh full-history baseline (which
  // provably covers it) and settled on success — resubmitting the old
  // payload could shrink the redirect's baseline coverage. The request stays
  // non-advancing: it carries the CURRENT bundle at the current epoch, and
  // the ordinary edit rides along.
  expect(materialized.healedStaleContentKeyBundle).toBe(false);
  const { request } = materialized.plan;
  expect(request.contentKeyBundle?.contentKeyEpoch).toBe(
    writerProjection.contentKeyBundle.contentKeyEpoch,
  );
  expect(request.outgoingUpdates).toHaveLength(2);
  expect(request.outgoingUpdates[0]?.checkpointKind).toBe("rotate_baseline");
  expect(request.outgoingUpdates[0]?.id).not.toBe(leftoverCheckpoint.id);
  expect(request.outgoingUpdates[1]?.id).toBe(pendingEdit.id);
  expect(materialized.heldBackPendingUpdateIds).toEqual([
    leftoverCheckpoint.id,
  ]);
  expect(materialized.staleRecoveryBaselineUpdateId).toBe(
    request.outgoingUpdates[0]?.id ?? "",
  );
});

test("syncRemoteDocument regenerates a rejected queued checkpoint and resubmits", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const doc = await createDocument("coverage-rejected-checkpoint");
  doc.getText("text").update("interrupted recovery history");
  doc.commit();
  const vectors = getUpdateVersionVectors(exportAllUpdates(doc));
  const leftoverCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440bbb",
    sourceVersionVector: vectors.partialEndVersionVector,
    updateData: bytesToBase64(exportFullHistorySnapshot(doc)),
    partialStartVersionVector: "{}",
    partialEndVersionVector: vectors.partialEndVersionVector,
  });
  const submittedRequests: DocumentSyncRequest[] = [];
  const traceLines: string[] = [];

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle sync retries");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedRequests.push(request);

        if (submittedRequests.length === 1) {
          const message = `POST /documents/${documentId}/sync: 409 : Document content-key rotation baseline does not cover the committed frontier`;
          return {
            code: undefined,
            message,
            ok: false,
            report: () => {},
            status: 409,
          };
        }

        const plan = await buildDocumentSyncPlan({
          author,
          contentKeyBundle: writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: writerProjection.documentKekTargets,
          documentManifest: writerProjection.documentManifest,
          localVersionVector: null,
        });
        return {
          data: await createSyncResponse({ ...plan, documentId, request }),
          ok: true,
        };
      },
    },
    author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(doc),
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onSyncTrace: (line) => traceLines.push(line),
    pendingUpdates: [leftoverCheckpoint],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  // First attempt passes the stale leftover through; the server's coverage
  // gate rejects it; the retry regenerates a fresh covering baseline under a
  // new id and succeeds, settling the leftover row it subsumes.
  expect(submittedRequests).toHaveLength(2);
  expect(submittedRequests[0]?.outgoingUpdates[0]?.id).toBe(
    leftoverCheckpoint.id,
  );
  const regenerated = submittedRequests[1]?.outgoingUpdates[0];
  expect(regenerated?.checkpointKind).toBe("rotate_baseline");
  expect(regenerated?.id).not.toBe(leftoverCheckpoint.id);
  expect(synced?.settledPendingUpdateIds).toContain(leftoverCheckpoint.id);
  expect(synced?.settledPendingUpdateIds).not.toContain(regenerated?.id ?? "");
  // The pass narrates itself in clipboard-safe trace lines.
  expect(traceLines).toContain(
    `document sync submit failed document=${writerProjection.documentId} status=409 code=none action=regenerate-checkpoints`,
  );
  expect(traceLines).toContain(
    `document sync checkpoint regeneration document=${writerProjection.documentId} checkpoints=1 updates=0`,
  );
});
