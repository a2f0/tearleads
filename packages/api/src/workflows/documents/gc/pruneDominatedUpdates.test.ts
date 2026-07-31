import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeDocumentContentRecordMetadataHash,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@tearleads/loro";
import { eq } from "drizzle-orm";
import { runPruneDominatedUpdatesWorkflow } from "./pruneDominatedUpdates";

// `early` ⊂ `late` (same peer); `concurrent` is a different peer `late` cannot
// dominate.
async function buildVersions() {
  const docA = await createDocument("prune-it-seed-a");
  const textA = docA.getText("text");
  textA.insert(0, "a");
  docA.commit();
  const early = encodeVersionVector(docA);
  textA.insert(1, "bcd");
  docA.commit();
  const late = encodeVersionVector(docA);

  const docB = await createDocument("prune-it-seed-b");
  docB.getText("text").insert(0, "z");
  docB.commit();
  const concurrent = encodeVersionVector(docB);

  return { early, late, concurrent };
}

async function insertUpdate(input: {
  documentId: string;
  partialEndVersionVector: string;
  contentKeyEpoch: number;
  encryptedData: string;
  sourceVersionVector?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const partialStartVersionVector = emptyVersionVector();
  const plaintextHash = `plaintext-${id}`;
  const metadataHash = input.sourceVersionVector
    ? await computeDocumentContentRecordMetadataHash({
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        documentId: input.documentId,
        partialEndVersionVector: input.partialEndVersionVector,
        partialStartVersionVector,
        plaintextHash,
        sourceVersionVector: input.sourceVersionVector,
        updateId: id,
      })
    : "ordinary-update-metadata-hash";
  await db.insert(documentUpdates).values({
    accessEpoch: 1,
    authorFingerprint: "prune-author",
    byteLength: new TextEncoder().encode(input.encryptedData).byteLength,
    documentId: input.documentId,
    encryptedData: input.encryptedData,
    id,
    partialEndVersionVector: input.partialEndVersionVector,
    partialStartVersionVector,
    plaintextHash,
  });
  await db.insert(documentContentWriteHeaders).values({
    accessManifestHash: "manifest",
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId: `record-${id}`,
    documentId: input.documentId,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    header: { metadataHash } as WriteHeader,
    headerHash: `header-hash-${id}`,
    nonceDomainHash: `nonce-${id}`,
    organizationId: crypto.randomUUID(),
    targetHash: `target-${id}`,
    updateId: id,
  });
  return id;
}

test("prune clears dominated pre-rotation payloads and keeps the rest", async () => {
  const { early, late, concurrent } = await buildVersions();
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "prune-creator" })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }
  const documentId = document.id;

  const dominatedId = await insertUpdate({
    contentKeyEpoch: 1,
    documentId,
    encryptedData: "old-dominated-payload",
    partialEndVersionVector: early,
  });
  const concurrentId = await insertUpdate({
    contentKeyEpoch: 1,
    documentId,
    encryptedData: "old-concurrent-payload",
    partialEndVersionVector: concurrent,
  });
  const baselineId = await insertUpdate({
    contentKeyEpoch: 2,
    documentId,
    encryptedData: "baseline-payload",
    partialEndVersionVector: late,
    sourceVersionVector: late,
  });
  await db.insert(documentAuditCheckpoints).values({
    accessEpoch: 1,
    accessManifestHash: "manifest",
    actorFingerprint: "prune-author",
    actorUserId: crypto.randomUUID(),
    baselineUpdateId: baselineId,
    checkpointHash: "checkpoint-hash",
    checkpointKind: "rotate_baseline",
    documentId,
    sourceVersionVector: late,
  });

  const summary = await runPruneDominatedUpdatesWorkflow(db, {
    documentIds: [documentId],
  });

  expect(summary.prunedUpdateCount).toBe(1);
  expect(summary.documentsAffected).toBe(1);
  expect(summary.reclaimedBytes).toBe(
    new TextEncoder().encode("old-dominated-payload").byteLength,
  );

  const payloadById = new Map(
    (
      await db
        .select({
          encryptedData: documentUpdates.encryptedData,
          id: documentUpdates.id,
        })
        .from(documentUpdates)
        .where(eq(documentUpdates.documentId, documentId))
    ).map((row) => [row.id, row.encryptedData]),
  );
  // Dominated pre-rotation update: payload cleared, row retained.
  expect(payloadById.get(dominatedId)).toBe("");
  // Concurrent pre-rotation write the baseline never covered: untouched.
  expect(payloadById.get(concurrentId)).toBe("old-concurrent-payload");
  // The baseline itself (current epoch): untouched.
  expect(payloadById.get(baselineId)).toBe("baseline-payload");
});
