import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import {
  createDocument,
  derivePeerId,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { eq, inArray } from "drizzle-orm";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { resolveDocumentAccessState } from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import {
  containerMetadataDocuments,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentContainerLinks,
  documentUpdateAuditEvents,
  documentUpdateSpans,
  documentUpdates,
} from "../../schema";
import { sha256Hex } from "../../utils/sha256";
import {
  CreateDocumentError,
  createDocumentSyncStore,
  DocumentUpdateError,
} from "./documentSyncStore";

async function getExpectedLinkedContainerAccessStateHashes(
  linkedContainerIds: string[],
): Promise<Record<string, string>> {
  const bindings = await db
    .select({
      containerId: containerMetadataDocuments.containerId,
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(inArray(containerMetadataDocuments.containerId, linkedContainerIds));

  const expectedLinkedContainerAccessStateHashes: Record<string, string> = {};

  for (const containerId of linkedContainerIds) {
    const binding = bindings.find((row) => row.containerId === containerId);
    if (!binding) {
      throw new Error(
        `Expected metadata document binding for container ${containerId}`,
      );
    }

    const access = await resolveDocumentAccessState(binding.documentId, db);
    if (!access) {
      throw new Error(
        `Expected metadata access state for container ${containerId}`,
      );
    }

    expectedLinkedContainerAccessStateHashes[containerId] =
      access.accessStateHash;
  }

  return expectedLinkedContainerAccessStateHashes;
}

async function createServiceDocument() {
  const { fingerprint, registration, user } = await registerServiceUser();
  const store = createDocumentSyncStore(createServiceTestRuntime());
  const created = await store.createDocument({
    createdByFingerprint: fingerprint,
    createdByUserId: registration.userId,
    expectedLinkedContainerAccessStateHashes:
      await getExpectedLinkedContainerAccessStateHashes([
        registration.rootContainerId,
      ]),
    linkedContainerIds: [registration.rootContainerId],
  });

  if (!created) {
    throw new Error("Failed to create service test document");
  }

  return { created, registration, store, user };
}

async function expectCreateDocumentError(
  promise: Promise<unknown>,
): Promise<CreateDocumentError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CreateDocumentError);
    return error as CreateDocumentError;
  }

  throw new Error("Expected createDocument to fail");
}

async function expectDocumentSyncStoreError(
  promise: Promise<unknown>,
): Promise<DocumentUpdateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentUpdateError);
    return error as DocumentUpdateError;
  }

  throw new Error("Expected document sync store operation to fail");
}

test("document sync store creates documents and resolves access through the runtime database", async () => {
  const { registration, user } = await registerServiceUser();
  const recording = createRecordingDb();
  const store = createDocumentSyncStore(createServiceTestRuntime(recording.db));

  const created = await store.createDocument({
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    createdByUserId: registration.userId,
    expectedLinkedContainerAccessStateHashes:
      await getExpectedLinkedContainerAccessStateHashes([
        registration.rootContainerId,
      ]),
    linkedContainerIds: [registration.rootContainerId],
  });

  expect(created?.currentAccessEpoch).toBe(1);
  expect(created?.documentRecipientEnvelopes).toHaveLength(1);
  expect(created?.recipientEncapsulationPublicKeys).toHaveLength(1);
  expect(recording.calls.get("transaction") ?? 0).toBeGreaterThan(0);

  const documentId = String(created?.document.id ?? "");
  const linkedContainer = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, documentId))
    .limit(1);
  expect(linkedContainer[0]?.containerId).toBe(registration.rootContainerId);

  const fetched = await store.getDocumentById(documentId);
  expect(fetched?.id).toBe(documentId);

  const access = await store.getDocumentAccess({
    documentId,
    userId: registration.userId,
  });
  expect(access?.canRead).toBe(true);
  expect(access?.canWrite).toBe(true);
  expect(access?.currentAccessEpoch).toBe(1);
  expect(access?.documentRecipientEnvelopes).toHaveLength(1);
  expect(recording.calls.get("select") ?? 0).toBeGreaterThan(0);
});

test("document sync store appends missing document updates idempotently", async () => {
  const { created, registration, store, user } = await createServiceDocument();
  const peerSeed = "document-sync-store-span-peer";
  const doc = await createDocument(peerSeed);
  const startVersion = encodeVersionVector(doc);
  doc.getText("text").update("service store update");
  const vectors = getUpdateVersionVectors(
    exportUpdatesSince(doc, startVersion),
  );
  const updateId = crypto.randomUUID();
  const update = {
    id: updateId,
    encryptedData: "encrypted-update",
    partialStartVersionVector: vectors.partialStartVersionVector,
    partialEndVersionVector: vectors.partialEndVersionVector,
  };
  const documentRecipientEnvelopes = created.documentRecipientEnvelopes;
  if (!documentRecipientEnvelopes) {
    throw new Error("Expected service test document recipient envelopes");
  }

  const firstAppend = await store.appendDocumentUpdates({
    authorUserId: registration.userId,
    documentId: created.document.id,
    authorFingerprint: await toFingerprint(user.signing.signingPublicKey),
    documentRecipientEnvelopes,
    updates: [update],
  });
  expect(firstAppend.acceptedOutgoingUpdateIds).toEqual([updateId]);
  expect(firstAppend.commitLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
  expect(firstAppend.documentRecipientEnvelopes).toEqual(
    documentRecipientEnvelopes,
  );

  const retryAppend = await store.appendDocumentUpdates({
    authorUserId: registration.userId,
    documentId: created.document.id,
    authorFingerprint: await toFingerprint(user.signing.signingPublicKey),
    documentRecipientEnvelopes,
    updates: [update],
  });
  expect(retryAppend.acceptedOutgoingUpdateIds).toEqual([updateId]);
  expect(retryAppend.commitLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);

  const dbRows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, created.document.id));
  expect(dbRows).toHaveLength(1);

  const spanRows = await db
    .select({
      endCounter: documentUpdateSpans.endCounter,
      peerId: documentUpdateSpans.peerId,
      startCounter: documentUpdateSpans.startCounter,
    })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.updateId, updateId));
  expect(spanRows).toHaveLength(1);
  expect(spanRows[0]).toEqual({
    endCounter: expect.any(Number),
    peerId: await derivePeerId(peerSeed),
    startCounter: 0,
  });
  expect(spanRows[0]?.endCounter).toBeGreaterThan(0);

  const auditEntries = await db
    .select({
      accessEpoch: documentAuditEntries.accessEpoch,
      actorFingerprint: documentAuditEntries.actorFingerprint,
      actorUserId: documentAuditEntries.actorUserId,
      entryHash: documentAuditEntries.entryHash,
      eventType: documentAuditEntries.eventType,
      prevEntryHash: documentAuditEntries.prevEntryHash,
    })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, created.document.id));
  expect(auditEntries).toHaveLength(1);
  expect(auditEntries[0]).toEqual({
    accessEpoch: created.currentAccessEpoch,
    actorFingerprint: await toFingerprint(user.signing.signingPublicKey),
    actorUserId: registration.userId,
    entryHash: expect.any(String),
    eventType: "loro_update",
    prevEntryHash: null,
  });

  const auditEvents = await db
    .select({
      encryptedUpdateByteLength:
        documentUpdateAuditEvents.encryptedUpdateByteLength,
      encryptedUpdateSha256: documentUpdateAuditEvents.encryptedUpdateSha256,
      liveUpdateId: documentUpdateAuditEvents.liveUpdateId,
      partialEndVersionVector:
        documentUpdateAuditEvents.partialEndVersionVector,
      partialStartVersionVector:
        documentUpdateAuditEvents.partialStartVersionVector,
      sourceVersionVector: documentUpdateAuditEvents.sourceVersionVector,
    })
    .from(documentUpdateAuditEvents)
    .where(eq(documentUpdateAuditEvents.liveUpdateId, updateId));
  expect(auditEvents).toHaveLength(1);
  expect(auditEvents[0]).toEqual({
    encryptedUpdateByteLength: new TextEncoder().encode(update.encryptedData)
      .byteLength,
    encryptedUpdateSha256: await sha256Hex(update.encryptedData),
    liveUpdateId: updateId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    sourceVersionVector: null,
  });
});

test("document sync store persists explicit baseline checkpoints", async () => {
  const { created, registration, store, user } = await createServiceDocument();
  const authorFingerprint = await toFingerprint(user.signing.signingPublicKey);
  const documentRecipientEnvelopes = created.documentRecipientEnvelopes;
  if (!documentRecipientEnvelopes) {
    throw new Error("Expected service test document recipient envelopes");
  }

  const firstDoc = await createDocument("document-sync-store-checkpoint-1");
  firstDoc.getText("text").update("baseline one");
  const firstUpdate = exportUpdatesSince(firstDoc, null);
  const firstVectors = getUpdateVersionVectors(firstUpdate);
  const firstSourceVersionVector = encodeVersionVector(firstDoc);
  const firstUpdateId = crypto.randomUUID();

  await store.appendDocumentUpdates({
    authorUserId: registration.userId,
    documentId: created.document.id,
    authorFingerprint,
    documentRecipientEnvelopes,
    updates: [
      {
        checkpointKind: "fresh_baseline",
        id: firstUpdateId,
        encryptedData: "encrypted-checkpoint-update-1",
        partialStartVersionVector: firstVectors.partialStartVersionVector,
        partialEndVersionVector: firstVectors.partialEndVersionVector,
        sourceVersionVector: firstSourceVersionVector,
      },
    ],
  });

  const secondDoc = await createDocument("document-sync-store-checkpoint-2");
  secondDoc.getText("text").update("baseline two");
  const secondUpdate = exportUpdatesSince(secondDoc, null);
  const secondVectors = getUpdateVersionVectors(secondUpdate);
  const secondSourceVersionVector = encodeVersionVector(secondDoc);
  const secondUpdateId = crypto.randomUUID();

  await store.appendDocumentUpdates({
    authorUserId: registration.userId,
    documentId: created.document.id,
    authorFingerprint,
    documentRecipientEnvelopes,
    updates: [
      {
        checkpointKind: "fresh_baseline",
        id: secondUpdateId,
        encryptedData: "encrypted-checkpoint-update-2",
        partialStartVersionVector: secondVectors.partialStartVersionVector,
        partialEndVersionVector: secondVectors.partialEndVersionVector,
        sourceVersionVector: secondSourceVersionVector,
      },
    ],
  });

  const checkpointRows = await db
    .select({
      accessEpoch: documentAuditCheckpoints.accessEpoch,
      actorFingerprint: documentAuditCheckpoints.actorFingerprint,
      actorUserId: documentAuditCheckpoints.actorUserId,
      baselineUpdateId: documentAuditCheckpoints.baselineUpdateId,
      checkpointHash: documentAuditCheckpoints.checkpointHash,
      checkpointKind: documentAuditCheckpoints.checkpointKind,
      coveredAuditEntryHash: documentAuditCheckpoints.coveredAuditEntryHash,
      previousCheckpointHash: documentAuditCheckpoints.previousCheckpointHash,
      sequence: documentAuditCheckpoints.sequence,
      sourceVersionVector: documentAuditCheckpoints.sourceVersionVector,
    })
    .from(documentAuditCheckpoints)
    .where(eq(documentAuditCheckpoints.documentId, created.document.id))
    .orderBy(documentAuditCheckpoints.sequence);
  expect(checkpointRows).toHaveLength(2);
  expect(checkpointRows[0]).toEqual({
    accessEpoch: created.currentAccessEpoch,
    actorFingerprint: authorFingerprint,
    actorUserId: registration.userId,
    baselineUpdateId: firstUpdateId,
    checkpointHash: expect.any(String),
    checkpointKind: "fresh_baseline",
    coveredAuditEntryHash: expect.any(String),
    previousCheckpointHash: null,
    sequence: expect.any(Number),
    sourceVersionVector: firstSourceVersionVector,
  });
  expect(checkpointRows[1]).toEqual({
    accessEpoch: created.currentAccessEpoch,
    actorFingerprint: authorFingerprint,
    actorUserId: registration.userId,
    baselineUpdateId: secondUpdateId,
    checkpointHash: expect.any(String),
    checkpointKind: "fresh_baseline",
    coveredAuditEntryHash: expect.any(String),
    previousCheckpointHash: checkpointRows[0]?.checkpointHash ?? null,
    sequence: expect.any(Number),
    sourceVersionVector: secondSourceVersionVector,
  });
  expect(checkpointRows[1]?.sequence).toBeGreaterThan(
    checkpointRows[0]?.sequence ?? 0,
  );
  const firstCoveredAuditEntryHash = checkpointRows[0]?.coveredAuditEntryHash;
  if (!firstCoveredAuditEntryHash) {
    throw new Error("Expected first checkpoint covered audit entry hash");
  }
  const secondCoveredAuditEntryHash = checkpointRows[1]?.coveredAuditEntryHash;
  if (!secondCoveredAuditEntryHash) {
    throw new Error("Expected second checkpoint covered audit entry hash");
  }

  const auditRows = await db
    .select({
      entryHash: documentAuditEntries.entryHash,
      prevEntryHash: documentAuditEntries.prevEntryHash,
      sequence: documentAuditEntries.sequence,
    })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, created.document.id))
    .orderBy(documentAuditEntries.sequence);
  expect(auditRows).toHaveLength(2);
  expect(auditRows[0]).toEqual({
    entryHash: firstCoveredAuditEntryHash,
    prevEntryHash: null,
    sequence: expect.any(Number),
  });
  expect(auditRows[1]).toEqual({
    entryHash: secondCoveredAuditEntryHash,
    prevEntryHash: auditRows[0]?.entryHash ?? null,
    sequence: expect.any(Number),
  });

  const auditEventRows = await db
    .select({
      auditEntryId: documentUpdateAuditEvents.auditEntryId,
      liveUpdateId: documentUpdateAuditEvents.liveUpdateId,
      sourceVersionVector: documentUpdateAuditEvents.sourceVersionVector,
    })
    .from(documentUpdateAuditEvents)
    .where(
      inArray(documentUpdateAuditEvents.liveUpdateId, [
        firstUpdateId,
        secondUpdateId,
      ]),
    );
  expect(auditEventRows).toHaveLength(2);
  expect(
    auditEventRows
      .map((row) => row.liveUpdateId)
      .sort((left, right) => left.localeCompare(right)),
  ).toEqual(
    [firstUpdateId, secondUpdateId].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
  expect(new Set(auditEventRows.map((row) => row.sourceVersionVector))).toEqual(
    new Set([firstSourceVersionVector, secondSourceVersionVector]),
  );
});

test("document sync store lists only causally missing document updates", async () => {
  const { created, registration, store, user } = await createServiceDocument();
  const aliceDoc = await createDocument("document-sync-store-missing-alice");
  const aliceStartVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("Hello from Alice");
  const firstUpdate = exportUpdatesSince(aliceDoc, aliceStartVersion);
  const firstVectors = getUpdateVersionVectors(firstUpdate);
  const bobDoc = await createDocument("document-sync-store-missing-bob");
  importUpdates(bobDoc, [firstUpdate]);
  const bobStartVersion = encodeVersionVector(bobDoc);
  bobDoc.getText("text").update("Hello from Alice and Bob");
  const secondUpdate = exportUpdatesSince(bobDoc, bobStartVersion);
  const secondVectors = getUpdateVersionVectors(secondUpdate);
  const documentRecipientEnvelopes = created.documentRecipientEnvelopes;
  if (!documentRecipientEnvelopes) {
    throw new Error("Expected service test document recipient envelopes");
  }

  const authorFingerprint = await toFingerprint(user.signing.signingPublicKey);
  const firstUpdateId = crypto.randomUUID();
  const secondUpdateId = crypto.randomUUID();
  await store.appendDocumentUpdates({
    authorUserId: registration.userId,
    documentId: created.document.id,
    authorFingerprint,
    documentRecipientEnvelopes,
    updates: [
      {
        id: firstUpdateId,
        encryptedData: "encrypted-first-update",
        partialStartVersionVector: firstVectors.partialStartVersionVector,
        partialEndVersionVector: firstVectors.partialEndVersionVector,
      },
    ],
  });
  await store.appendDocumentUpdates({
    authorUserId: registration.userId,
    documentId: created.document.id,
    authorFingerprint,
    documentRecipientEnvelopes,
    updates: [
      {
        id: secondUpdateId,
        encryptedData: "encrypted-second-update",
        partialStartVersionVector: secondVectors.partialStartVersionVector,
        partialEndVersionVector: secondVectors.partialEndVersionVector,
      },
    ],
  });

  const allMissing = await store.listMissingDocumentUpdates({
    documentId: created.document.id,
    localVersionVector: null,
  });
  expect(allMissing.map((update) => update.id)).toEqual([
    firstUpdateId,
    secondUpdateId,
  ]);

  const missingAfterFirstUpdate = await store.listMissingDocumentUpdates({
    documentId: created.document.id,
    localVersionVector: encodeVersionVector(aliceDoc),
  });
  expect(missingAfterFirstUpdate.map((update) => update.id)).toEqual([
    secondUpdateId,
  ]);

  const missingAfterSecondUpdate = await store.listMissingDocumentUpdates({
    documentId: created.document.id,
    localVersionVector: encodeVersionVector(bobDoc),
  });
  expect(missingAfterSecondUpdate).toEqual([]);
});

test("document sync store rejects unsatisfied minLsn reads", async () => {
  const { created, store } = await createServiceDocument();

  const error = await expectDocumentSyncStoreError(
    store.listMissingDocumentUpdates({
      documentId: created.document.id,
      localVersionVector: null,
      minLsn: "FFFFFFFF/FFFFFFFF",
    }),
  );
  expect(error.status).toBe(503);
  expect(error.message).toBe(
    "Requested minimum commit LSN has not been reached",
  );
});

test("document sync store rejects malformed local version vectors", async () => {
  const { created, store } = await createServiceDocument();

  const error = await expectDocumentSyncStoreError(
    store.listMissingDocumentUpdates({
      documentId: created.document.id,
      localVersionVector: "not-base64",
    }),
  );
  expect(error.status).toBe(400);
  expect(error.message).toBe("Invalid local version vector");
});

test("document sync store reports create and append errors", async () => {
  const { registration, user } = await registerServiceUser();
  const other = await registerServiceUser();
  const store = createDocumentSyncStore(createServiceTestRuntime());

  const duplicateContainers = await expectCreateDocumentError(
    store.createDocument({
      createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
      createdByUserId: registration.userId,
      expectedLinkedContainerAccessStateHashes:
        await getExpectedLinkedContainerAccessStateHashes([
          registration.rootContainerId,
        ]),
      linkedContainerIds: [
        registration.rootContainerId,
        registration.rootContainerId,
      ],
    }),
  );
  expect(duplicateContainers.status).toBe(400);
  expect(duplicateContainers.message).toBe(
    "linkedContainerIds must not contain duplicates",
  );

  const forbiddenContainer = await expectCreateDocumentError(
    store.createDocument({
      createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
      createdByUserId: other.registration.userId,
      expectedLinkedContainerAccessStateHashes:
        await getExpectedLinkedContainerAccessStateHashes([
          registration.rootContainerId,
        ]),
      linkedContainerIds: [registration.rootContainerId],
    }),
  );
  expect(forbiddenContainer.status).toBe(403);
  expect(forbiddenContainer.message).toBe("Forbidden");

  const staleAccessStateHash = await expectCreateDocumentError(
    store.createDocument({
      createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
      createdByUserId: registration.userId,
      expectedLinkedContainerAccessStateHashes: {
        [registration.rootContainerId]: "stale-access-state-hash",
      },
      linkedContainerIds: [registration.rootContainerId],
    }),
  );
  expect(staleAccessStateHash.status).toBe(409);
  expect(staleAccessStateHash.message).toBe("Stale access state hash");

  const missingDocument = await expectDocumentSyncStoreError(
    store.appendDocumentUpdates({
      authorUserId: registration.userId,
      documentId: crypto.randomUUID(),
      authorFingerprint: await toFingerprint(user.signing.signingPublicKey),
      updates: [],
    }),
  );
  expect(missingDocument.status).toBe(409);
  expect(missingDocument.message).toBe("Document access state not found");
});
