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
import { eq, inArray } from "drizzle-orm";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { resolveDocumentAccessState } from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import {
  containerMetadataDocuments,
  documentAttachmentAuditEvents,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentUpdateAuditEvents,
} from "../../schema";
import { stageBlob } from "../blobs/stageBlob";
import { commitDocumentChange } from "./commitDocumentChange";
import { createDocumentSyncStore } from "./documentSyncStore";
import { verifyDocumentAuditHistory } from "./verifyDocumentAuditHistory";

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
    sha256: Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(input.encryptedBytes),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join(""),
    userId: input.userId,
  });
}

async function createDocumentWithAuditHistory() {
  const { created, fingerprint, registration, user } =
    await createServiceDocument();
  const encryptedBytes = await createEncryptedBlobBytes(
    "audit-history-blob",
    created.recipientEncapsulationPublicKeys,
  );
  const stage = await stageServiceBlob({
    encryptedBytes,
    userId: registration.userId,
  });

  await commitDocumentChange(createServiceTestRuntime(), {
    documentId: created.document.id,
    request: {
      accessEpoch: created.currentAccessEpoch,
      expectedAccessStateHash: created.currentAccessStateHash,
      attachmentCommits: [
        {
          expectedBindingId: null,
          slotId: "audit-slot",
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
  });

  const currentDocumentRecipientEnvelopes = created.documentRecipientEnvelopes;
  if (!currentDocumentRecipientEnvelopes) {
    throw new Error("Expected service test document recipient envelopes");
  }
  const { documentKey } = await readDocumentEncryption({
    documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
    secretKey: user.kem.secretKey,
  });
  const loroDoc = await createLoroDocument("verify-document-audit-history");
  loroDoc.getText("text").update("baseline checkpoint");
  const baselineUpdate = exportUpdatesSince(loroDoc, null);
  const baselineVectors = getUpdateVersionVectors(baselineUpdate);
  const sourceVersionVector = encodeVersionVector(loroDoc);

  await commitDocumentChange(createServiceTestRuntime(), {
    documentId: created.document.id,
    request: {
      accessEpoch: created.currentAccessEpoch,
      expectedAccessStateHash: created.currentAccessStateHash,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: {
        checkpointKind: "fresh_baseline",
        id: crypto.randomUUID(),
        encryptedData: await encryptLoroUpdate(
          baselineUpdate,
          created.currentAccessEpoch,
          documentKey,
        ),
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

  return { documentId: created.document.id };
}

test("verifyDocumentAuditHistory accepts a valid mixed document history", async () => {
  const { documentId } = await createDocumentWithAuditHistory();

  const result = await verifyDocumentAuditHistory(db, { documentId });

  expect(result).toEqual({
    attachmentEventCount: 1,
    auditEntryCount: 2,
    checkpointCount: 1,
    documentId,
    errors: [],
    isValid: true,
    updateEventCount: 1,
  });
});

test("verifyDocumentAuditHistory detects tampered document update audit metadata", async () => {
  const { documentId } = await createDocumentWithAuditHistory();

  const [updateEvent] = await db
    .select({ auditEntryId: documentUpdateAuditEvents.auditEntryId })
    .from(documentUpdateAuditEvents)
    .innerJoin(
      documentAuditEntries,
      eq(documentAuditEntries.id, documentUpdateAuditEvents.auditEntryId),
    )
    .where(eq(documentAuditEntries.documentId, documentId))
    .limit(1);
  if (!updateEvent) {
    throw new Error("Expected document update audit event");
  }

  await db
    .update(documentUpdateAuditEvents)
    .set({ encryptedUpdateSha256: "tampered-update-sha256" })
    .where(
      eq(documentUpdateAuditEvents.auditEntryId, updateEvent.auditEntryId),
    );

  const result = await verifyDocumentAuditHistory(db, { documentId });

  expect(result.isValid).toBe(false);
  expect(
    result.errors.some((error) =>
      error.startsWith(
        "Document update audit entry hash mismatch at sequence ",
      ),
    ),
  ).toBe(true);
});

test("verifyDocumentAuditHistory detects tampered attachment audit metadata", async () => {
  const { documentId } = await createDocumentWithAuditHistory();

  const [attachmentEvent] = await db
    .select({ auditEntryId: documentAttachmentAuditEvents.auditEntryId })
    .from(documentAttachmentAuditEvents)
    .innerJoin(
      documentAuditEntries,
      eq(documentAuditEntries.id, documentAttachmentAuditEvents.auditEntryId),
    )
    .where(eq(documentAuditEntries.documentId, documentId))
    .limit(1);
  if (!attachmentEvent) {
    throw new Error("Expected attachment audit event");
  }

  await db
    .update(documentAttachmentAuditEvents)
    .set({ slotId: "tampered-slot" })
    .where(
      eq(
        documentAttachmentAuditEvents.auditEntryId,
        attachmentEvent.auditEntryId,
      ),
    );

  const result = await verifyDocumentAuditHistory(db, { documentId });

  expect(result.isValid).toBe(false);
  expect(
    result.errors.some((error) =>
      error.startsWith("Attachment audit entry hash mismatch at sequence "),
    ),
  ).toBe(true);
});

test("verifyDocumentAuditHistory detects tampered checkpoint coverage", async () => {
  const { documentId } = await createDocumentWithAuditHistory();

  await db
    .update(documentAuditCheckpoints)
    .set({ coveredAuditEntryHash: "tampered-covered-audit-hash" })
    .where(eq(documentAuditCheckpoints.documentId, documentId));

  const result = await verifyDocumentAuditHistory(db, { documentId });

  expect(result.isValid).toBe(false);
  expect(
    result.errors.some(
      (error) =>
        error ===
          "Checkpoint sequence 6 covers unknown audit entry hash tampered-covered-audit-hash" ||
        error.endsWith(
          "covers unknown audit entry hash tampered-covered-audit-hash",
        ),
    ),
  ).toBe(true);
});
