import { expect, test } from "bun:test";
import {
  encryptForRecipients,
  serializeBlobEnvelope,
  unwrapDek,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument as createLoroDocument,
  encodeVersionVector,
  encryptLoroUpdate,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { eq } from "drizzle-orm";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { db } from "../../adapters/postgres";
import {
  attachmentBindings,
  blobStages,
  blobs,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentUpdateAuditEvents,
} from "../../schema";
import { sha256Hex } from "../../utils/sha256";
import { stageBlob } from "../blobs/stageBlob";
import {
  CommitDocumentChangeError,
  commitDocumentChange,
} from "./commitDocumentChange";
import { createDocumentSyncStore } from "./documentSyncStore";

async function createServiceDocument() {
  const { fingerprint, registration, user } = await registerServiceUser();
  const store = createDocumentSyncStore(createServiceTestRuntime());
  const created = await store.createDocument({
    createdByFingerprint: fingerprint,
    createdByUserId: registration.userId,
    linkedContainerIds: [registration.rootContainerId],
  });

  if (!created) {
    throw new Error("Failed to create service test document");
  }

  return { created, fingerprint, registration, user };
}

async function readDocumentEncryption(input: {
  documentRecipientEnvelopes: Array<{
    keyFingerprint: string;
    kemCipherText: string;
    wrappedKey: string;
  }>;
  secretKey: Uint8Array;
}) {
  return {
    documentKey: await unwrapDek(
      input.documentRecipientEnvelopes.map((recipient) => ({
        keyFingerprint: recipient.keyFingerprint,
        kemCipherText: base64ToBytes(recipient.kemCipherText),
        wrappedKey: base64ToBytes(recipient.wrappedKey),
      })),
      input.secretKey,
    ),
    documentRecipientEnvelopes: input.documentRecipientEnvelopes,
  };
}

async function createEncryptedBlobBytes(
  plaintext: string,
  encodedRecipientPublicKeys: string[],
): Promise<string> {
  const envelope = await encryptForRecipients(
    new TextEncoder().encode(plaintext),
    encodedRecipientPublicKeys.map((publicKey) => base64ToBytes(publicKey)),
  );

  return serializeBlobEnvelope(envelope);
}

async function stageServiceBlob(input: {
  encryptedBytes: string;
  userId: string;
}) {
  return stageBlob(createServiceTestRuntime(), {
    encryptedBytes: input.encryptedBytes,
    byteLength: new TextEncoder().encode(input.encryptedBytes).byteLength,
    sha256: await sha256Hex(input.encryptedBytes),
    userId: input.userId,
  });
}

async function expectCommitDocumentChangeError(
  promise: Promise<unknown>,
): Promise<CommitDocumentChangeError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommitDocumentChangeError);
    return error as CommitDocumentChangeError;
  }

  throw new Error("Expected commitDocumentChange to fail");
}

test("commitDocumentChange promotes staged blobs into active attachment bindings", async () => {
  const { created, fingerprint, registration } = await createServiceDocument();
  const encryptedBytes = await createEncryptedBlobBytes(
    "service-attachment-bytes",
    created.recipientEncapsulationPublicKeys,
  );
  const stage = await stageServiceBlob({
    encryptedBytes,
    userId: registration.userId,
  });
  const recording = createRecordingDb();

  const result = await commitDocumentChange(
    createServiceTestRuntime(recording.db),
    {
      documentId: created.document.id,
      request: {
        accessEpoch: created.currentAccessEpoch,
        expectedAccessStateHash: created.currentAccessStateHash,
        attachmentCommits: [
          {
            expectedBindingId: null,
            slotId: "service-slot",
            stageId: stage.stageId,
          },
        ],
        attachmentDetaches: [],
        attachmentRewraps: [],
        loroUpdate: null,
      },
      session: {
        fingerprint,
        userId: registration.userId,
      },
    },
  );

  expect(result.currentAccessEpoch).toBe(created.currentAccessEpoch);
  expect(result.acceptedOutgoingUpdateIds).toEqual([]);
  expect(result.committedBindings).toEqual([
    {
      bindingId: expect.any(String),
      blobId: expect.any(String),
      slotId: "service-slot",
    },
  ]);
  expect(result.detachedBindingIds).toEqual([]);
  expect(result.documentRecipientEnvelopes).toEqual(
    created.documentRecipientEnvelopes,
  );
  expect(recording.calls.get("transaction") ?? 0).toBeGreaterThan(0);
  const committedBinding = result.committedBindings[0];
  if (!committedBinding) {
    throw new Error("Expected service test committed binding");
  }

  const [binding] = await db
    .select({
      blobId: attachmentBindings.blobId,
      documentId: attachmentBindings.documentId,
      slotId: attachmentBindings.slotId,
    })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, committedBinding.bindingId))
    .limit(1);
  expect(binding).toEqual({
    blobId: committedBinding.blobId,
    documentId: created.document.id,
    slotId: "service-slot",
  });

  const [blob] = await db
    .select({
      encryptedBytes: blobs.encryptedBytes,
      storageKey: blobs.storageKey,
    })
    .from(blobs)
    .where(eq(blobs.id, committedBinding.blobId))
    .limit(1);
  expect(blob).toEqual({
    encryptedBytes,
    storageKey: stage.stageId,
  });

  const [remainingStage] = await db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.id, stage.stageId))
    .limit(1);
  expect(remainingStage).toBeUndefined();
});

test("commitDocumentChange persists explicit baseline checkpoints", async () => {
  const { created, fingerprint, registration, user } =
    await createServiceDocument();
  const currentDocumentRecipientEnvelopes = created.documentRecipientEnvelopes;
  if (!currentDocumentRecipientEnvelopes) {
    throw new Error("Expected service test document recipient envelopes");
  }

  const { documentKey } = await readDocumentEncryption({
    documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
    secretKey: user.kem.secretKey,
  });
  const loroDoc = await createLoroDocument("service-commit-baseline");
  loroDoc.getText("text").update("baseline checkpoint");
  const baselineUpdate = exportUpdatesSince(loroDoc, null);
  const baselineVectors = getUpdateVersionVectors(baselineUpdate);
  const sourceVersionVector = encodeVersionVector(loroDoc);
  const updateId = crypto.randomUUID();
  const encryptedData = await encryptLoroUpdate(
    baselineUpdate,
    created.currentAccessEpoch,
    documentKey,
  );

  const result = await commitDocumentChange(createServiceTestRuntime(), {
    documentId: created.document.id,
    request: {
      accessEpoch: created.currentAccessEpoch,
      expectedAccessStateHash: created.currentAccessStateHash,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: {
        checkpointKind: "fresh_baseline",
        id: updateId,
        encryptedData,
        partialStartVersionVector: baselineVectors.partialStartVersionVector,
        partialEndVersionVector: baselineVectors.partialEndVersionVector,
        referencedSlotIds: [],
        sourceVersionVector,
      },
    },
    session: {
      fingerprint,
      userId: registration.userId,
    },
  });

  expect(result.acceptedOutgoingUpdateIds).toEqual([updateId]);

  const [checkpointRow] = await db
    .select({
      accessEpoch: documentAuditCheckpoints.accessEpoch,
      actorFingerprint: documentAuditCheckpoints.actorFingerprint,
      actorUserId: documentAuditCheckpoints.actorUserId,
      baselineUpdateId: documentAuditCheckpoints.baselineUpdateId,
      checkpointKind: documentAuditCheckpoints.checkpointKind,
      coveredAuditEntryHash: documentAuditCheckpoints.coveredAuditEntryHash,
      previousCheckpointHash: documentAuditCheckpoints.previousCheckpointHash,
      sourceVersionVector: documentAuditCheckpoints.sourceVersionVector,
    })
    .from(documentAuditCheckpoints)
    .where(eq(documentAuditCheckpoints.baselineUpdateId, updateId))
    .limit(1);
  expect(checkpointRow).toEqual({
    accessEpoch: created.currentAccessEpoch,
    actorFingerprint: fingerprint,
    actorUserId: registration.userId,
    baselineUpdateId: updateId,
    checkpointKind: "fresh_baseline",
    coveredAuditEntryHash: expect.any(String),
    previousCheckpointHash: null,
    sourceVersionVector,
  });
  const coveredAuditEntryHash = checkpointRow?.coveredAuditEntryHash;
  if (!coveredAuditEntryHash) {
    throw new Error("Expected checkpoint covered audit entry hash");
  }

  const [auditEntry] = await db
    .select({
      accessEpoch: documentAuditEntries.accessEpoch,
      actorFingerprint: documentAuditEntries.actorFingerprint,
      actorUserId: documentAuditEntries.actorUserId,
      entryHash: documentAuditEntries.entryHash,
      eventType: documentAuditEntries.eventType,
      prevEntryHash: documentAuditEntries.prevEntryHash,
    })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, created.document.id))
    .limit(1);
  expect(auditEntry).toEqual({
    accessEpoch: created.currentAccessEpoch,
    actorFingerprint: fingerprint,
    actorUserId: registration.userId,
    entryHash: coveredAuditEntryHash,
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
    encryptedUpdateByteLength: new TextEncoder().encode(encryptedData)
      .byteLength,
    encryptedUpdateSha256: await sha256Hex(encryptedData),
    liveUpdateId: updateId,
    partialEndVersionVector: baselineVectors.partialEndVersionVector,
    partialStartVersionVector: baselineVectors.partialStartVersionVector,
    sourceVersionVector,
  });
});

test("commitDocumentChange reports missing, forbidden, and stale access cases", async () => {
  const { created, fingerprint, registration } = await createServiceDocument();
  const other = await registerServiceUser();

  const missing = await expectCommitDocumentChangeError(
    commitDocumentChange(createServiceTestRuntime(), {
      documentId: crypto.randomUUID(),
      request: {
        accessEpoch: created.currentAccessEpoch,
        expectedAccessStateHash: created.currentAccessStateHash,
        attachmentCommits: [],
        attachmentDetaches: [],
        attachmentRewraps: [],
        loroUpdate: null,
      },
      session: {
        fingerprint,
        userId: registration.userId,
      },
    }),
  );
  expect(missing.status).toBe(404);
  expect(missing.message).toBe("Document not found");

  const forbidden = await expectCommitDocumentChangeError(
    commitDocumentChange(createServiceTestRuntime(), {
      documentId: created.document.id,
      request: {
        accessEpoch: created.currentAccessEpoch,
        expectedAccessStateHash: created.currentAccessStateHash,
        attachmentCommits: [],
        attachmentDetaches: [],
        attachmentRewraps: [],
        loroUpdate: null,
      },
      session: {
        fingerprint: other.fingerprint,
        userId: other.registration.userId,
      },
    }),
  );
  expect(forbidden.status).toBe(403);
  expect(forbidden.message).toBe("Forbidden");

  const stale = await expectCommitDocumentChangeError(
    commitDocumentChange(createServiceTestRuntime(), {
      documentId: created.document.id,
      request: {
        accessEpoch: created.currentAccessEpoch + 1,
        expectedAccessStateHash: created.currentAccessStateHash,
        attachmentCommits: [],
        attachmentDetaches: [],
        attachmentRewraps: [],
        loroUpdate: null,
      },
      session: {
        fingerprint,
        userId: registration.userId,
      },
    }),
  );
  expect(stale.status).toBe(409);
  expect(stale.message).toBe("Stale access epoch");
});
