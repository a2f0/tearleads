import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobs,
  documentAttachmentAuditEvents,
  documentAuditCheckpoints,
  documentAuditEntries,
  documents,
  documentUpdateAuditEvents,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { sha256Hex } from "../utils/sha256";
import { appendDocumentAttachmentAuditEntries } from "./documentAttachmentAuditEvents";
import { maybeWriteDocumentAuditCheckpoint } from "./documentAuditCheckpoints";
import { appendDocumentUpdateAuditEntries } from "./documentAuditEntries";
import { verifyDocumentAuditHistory } from "./verifyDocumentAuditHistory";

const ACCESS_EPOCH = 1;
const ACCESS_MANIFEST_HASH = "audit-history-access-manifest";
const ACCESS_STATE_HASH = "audit-history-access-state-hash";
const ACTOR_FINGERPRINT = "audit-history-actor-fingerprint";

async function createDocumentWithAuditHistory() {
  const actorUserId = crypto.randomUUID();
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: ACTOR_FINGERPRINT })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create audit test document");
  }

  const encryptedBytes = "audit-history-blob";
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      sha256: await sha256Hex(encryptedBytes),
      storageKey: `audit-history/${crypto.randomUUID()}`,
    })
    .returning({ id: blobs.id });
  if (!blob) {
    throw new Error("Failed to create audit test blob");
  }

  await appendDocumentAttachmentAuditEntries(db, {
    accessEpoch: ACCESS_EPOCH,
    accessManifestHash: ACCESS_MANIFEST_HASH,
    accessStateHash: ACCESS_STATE_HASH,
    actorFingerprint: ACTOR_FINGERPRINT,
    actorUserId,
    documentId: document.id,
    organizationId: crypto.randomUUID(),
    events: [
      {
        action: "attach",
        bindingId: crypto.randomUUID(),
        blobId: blob.id,
        previousBindingId: null,
        previousBlobId: null,
        slotId: "audit-slot",
      },
    ],
  });

  const checkpointUpdate = {
    checkpointKind: "rotate_baseline",
    encryptedData: "encrypted-baseline-update",
    id: crypto.randomUUID(),
    partialEndVersionVector: "baseline-end-version-vector",
    partialStartVersionVector: "baseline-start-version-vector",
    plaintextHash: "baseline-plaintext-hash",
    sourceVersionVector: "baseline-source-version-vector",
  } as const;
  const auditEntryHashByUpdateId = await appendDocumentUpdateAuditEntries(db, {
    accessEpoch: ACCESS_EPOCH,
    accessManifestHash: ACCESS_MANIFEST_HASH,
    accessStateHash: ACCESS_STATE_HASH,
    actorFingerprint: ACTOR_FINGERPRINT,
    actorUserId,
    documentId: document.id,
    updates: [checkpointUpdate],
  });
  const coveredAuditEntryHash = auditEntryHashByUpdateId.get(
    checkpointUpdate.id,
  );
  if (!coveredAuditEntryHash) {
    throw new Error("Expected checkpoint update audit entry hash");
  }

  await maybeWriteDocumentAuditCheckpoint(db, {
    accessEpoch: ACCESS_EPOCH,
    accessManifestHash: ACCESS_MANIFEST_HASH,
    accessStateHash: ACCESS_STATE_HASH,
    actorFingerprint: ACTOR_FINGERPRINT,
    actorUserId,
    checkpointUpdate,
    coveredAuditEntryHash,
    documentId: document.id,
  });

  return { documentId: document.id };
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

test("verifyDocumentAuditHistory detects a tampered plaintext hash", async () => {
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
    .set({ plaintextHash: "tampered-plaintext-hash" })
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

test("verifyDocumentAuditHistory detects a tampered ciphertext digest", async () => {
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
    .set({ encryptedUpdateSha256: "tampered-ciphertext-digest" })
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

test("verifyDocumentAuditHistory detects tampered audit access state hash", async () => {
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
    .update(documentAuditEntries)
    .set({ accessStateHash: "tampered-access-state-hash" })
    .where(eq(documentAuditEntries.id, updateEvent.auditEntryId));

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

test("verifyDocumentAuditHistory detects tampered checkpoint access state hash", async () => {
  const { documentId } = await createDocumentWithAuditHistory();

  await db
    .update(documentAuditCheckpoints)
    .set({ accessStateHash: "tampered-access-state-hash" })
    .where(eq(documentAuditCheckpoints.documentId, documentId));

  const result = await verifyDocumentAuditHistory(db, { documentId });

  expect(result.isValid).toBe(false);
  expect(
    result.errors.some((error) =>
      error.startsWith("Checkpoint hash mismatch at sequence "),
    ),
  ).toBe(true);
});

test("audit entry sequences are engine-assigned and strictly increasing", async () => {
  const actorUserId = crypto.randomUUID();
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: ACTOR_FINGERPRINT })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create audit test document");
  }

  // Append two update audit entries without ever supplying a `sequence`. The
  // database engine must assign it (Postgres GENERATED ALWAYS AS IDENTITY /
  // SQLite INTEGER PRIMARY KEY AUTOINCREMENT); the hash-chain ordering relies on
  // these values being non-null and strictly increasing.
  for (let index = 0; index < 2; index += 1) {
    await appendDocumentUpdateAuditEntries(db, {
      accessEpoch: ACCESS_EPOCH,
      accessManifestHash: ACCESS_MANIFEST_HASH,
      accessStateHash: ACCESS_STATE_HASH,
      actorFingerprint: ACTOR_FINGERPRINT,
      actorUserId,
      documentId: document.id,
      updates: [
        {
          encryptedData: `sequence-update-${index}`,
          id: crypto.randomUUID(),
          partialEndVersionVector: `sequence-end-${index}`,
          partialStartVersionVector: `sequence-start-${index}`,
          plaintextHash: `sequence-plaintext-${index}`,
        },
      ],
    });
  }

  const rows = await db
    .select({ sequence: documentAuditEntries.sequence })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, document.id))
    .orderBy(documentAuditEntries.sequence);

  expect(rows.length).toBe(2);
  for (const row of rows) {
    expect(Number.isInteger(row.sequence)).toBe(true);
    expect(row.sequence).toBeGreaterThan(0);
  }
  const [first, second] = rows;
  expect(second?.sequence).toBeGreaterThan(first?.sequence ?? 0);
});
