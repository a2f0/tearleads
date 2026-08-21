import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
  documents,
  documentUpdateSpans,
  documentUpdates,
} from "@symcrypt/api-shared/schema";
import type {
  ContentRecordEncryptionSuite,
  WriteHeader,
} from "@symcrypt/crypto";
import { computeDocumentContentRecordMetadataHash } from "@symcrypt/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@symcrypt/loro";
import { eq } from "drizzle-orm";
import {
  computeDocumentEditAttribution,
  runPreparedDocumentEditAttributionDataWorkflow,
} from "./documentEditAttribution";

// `early` ⊂ `late` on the same peer: the baseline's frontier (`late`) provably
// dominates alice's pre-rotation update (`early`).
async function buildVersions() {
  const doc = await createDocument("attribution-it-seed");
  const text = doc.getText("text");
  text.insert(0, "a");
  doc.commit();
  const early = encodeVersionVector(doc);
  text.insert(1, "bcdefghij");
  doc.commit();
  const late = encodeVersionVector(doc);
  return { early, late };
}

// One signed update + its write header. `sequence` is a generated identity, so
// insert order fixes server-receive order: alice (called first) precedes the
// baseline, which is what makes earliest-span-wins credit alice, not the
// re-asserter.
async function insertUpdate(input: {
  documentId: string;
  contentKeyEpoch: number;
  encryptedData: string;
  partialEndVersionVector: string;
  checkpointSourceVersionVector?: string;
  writerUserId: string;
  writerKeyFingerprint: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const plaintextHash = `plaintext-${id}`;
  const partialStartVersionVector = input.checkpointSourceVersionVector
    ? emptyVersionVector()
    : "start";
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    ...(input.checkpointSourceVersionVector
      ? {
          checkpointKind: "rotate_baseline" as const,
          checkpointPayloadKind: "full_history_snapshot" as const,
          sourceVersionVector: input.checkpointSourceVersionVector,
        }
      : {}),
    documentId: input.documentId,
    partialEndVersionVector: input.partialEndVersionVector,
    partialStartVersionVector,
    plaintextHash,
    updateId: id,
  });
  await db.insert(documentUpdates).values({
    accessEpoch: 1,
    authorFingerprint: input.writerKeyFingerprint,
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
    encryptionSuite: "suite" as ContentRecordEncryptionSuite,
    // Attribution reads only these two fields off the header JSON.
    header: {
      metadataHash,
      writerUserId: input.writerUserId,
      writerKeyFingerprint: input.writerKeyFingerprint,
    } as WriteHeader,
    headerHash: `header-hash-${id}`,
    nonceDomainHash: `nonce-${id}`,
    organizationId: crypto.randomUUID(),
    targetHash: `target-${id}`,
    updateId: id,
  });
  return id;
}

async function insertSpan(input: {
  documentId: string;
  updateId: string;
  peerId: string;
  startCounter: number;
  endCounter: number;
}): Promise<void> {
  await db.insert(documentUpdateSpans).values(input);
}

function attributionShape(
  result: Awaited<ReturnType<typeof computeDocumentEditAttribution>>,
) {
  return result.segments.map((segment) => ({
    peerId: segment.peerId,
    startCounter: segment.startCounter,
    endCounter: segment.endCounter,
    updateId: segment.updateId,
    writerUserId: segment.writerUserId,
    writerKeyFingerprint: segment.writerKeyFingerprint,
    authorityKind: segment.authorityKind,
  }));
}

// Exercise earliest-span-wins across a rotation: alice edits, then bob uploads
// a rotate_baseline re-asserting the peer from zero. The re-assertion must not
// take authorship credit for operations the server received from alice first.
test("attributes original uploads ahead of a rotation baseline re-assertion", async () => {
  const { early, late } = await buildVersions();
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "attribution-creator" })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }
  const documentId = document.id;

  // alice's incremental pre-rotation update first delivered peer-1 ops [0,3).
  const aliceUpdateId = await insertUpdate({
    contentKeyEpoch: 1,
    documentId,
    encryptedData: "alice-pre-rotation-payload",
    partialEndVersionVector: early,
    writerKeyFingerprint: "fp-alice",
    writerUserId: "alice",
  });
  await insertSpan({
    documentId,
    endCounter: 3,
    peerId: "1",
    startCounter: 0,
    updateId: aliceUpdateId,
  });

  // bob rotates the key (new epoch) and uploads a rotate_baseline that
  // re-asserts the whole peer [0,10) at a later server sequence.
  const baselineUpdateId = await insertUpdate({
    checkpointSourceVersionVector: late,
    contentKeyEpoch: 2,
    documentId,
    encryptedData: "bob-baseline-payload",
    partialEndVersionVector: late,
    writerKeyFingerprint: "fp-bob",
    writerUserId: "bob",
  });
  await insertSpan({
    documentId,
    endCounter: 10,
    peerId: "1",
    startCounter: 0,
    updateId: baselineUpdateId,
  });
  await db.insert(documentAuditCheckpoints).values({
    accessEpoch: 1,
    accessManifestHash: "manifest",
    actorFingerprint: "fp-bob",
    // A uuid column; attribution reads writerUserId off the write-header JSON,
    // not the checkpoint actor, so this is independent of the "bob" writer.
    actorUserId: crypto.randomUUID(),
    baselineUpdateId,
    checkpointHash: "checkpoint-hash",
    checkpointKind: "rotate_baseline",
    documentId,
    sourceVersionVector: late,
  });

  // Earliest-span-wins: alice keeps [0,3) as a direct edit under her own key;
  // only the genuinely-new [3,10) the baseline first delivered is credited to
  // bob, flagged "baseline" (a re-assertion, not proof of authorship).
  const expected: ReturnType<typeof attributionShape> = [
    {
      authorityKind: "direct",
      endCounter: 3,
      peerId: "1",
      startCounter: 0,
      updateId: aliceUpdateId,
      writerKeyFingerprint: "fp-alice",
      writerUserId: "alice",
    },
    {
      authorityKind: "baseline",
      endCounter: 10,
      peerId: "1",
      startCounter: 3,
      updateId: baselineUpdateId,
      writerKeyFingerprint: "fp-bob",
      writerUserId: "bob",
    },
  ];

  const attribution = await computeDocumentEditAttribution(documentId, db);
  expect(attributionShape(attribution)).toEqual(expected);
});

test("rejects attribution spans whose write-header identity is missing", async () => {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "attribution-integrity-test" })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }

  const updateId = crypto.randomUUID();
  await db.insert(documentUpdates).values({
    accessEpoch: 1,
    authorFingerprint: "missing-header",
    byteLength: 7,
    documentId: document.id,
    encryptedData: "payload",
    id: updateId,
    partialEndVersionVector: "end",
    partialStartVersionVector: "start",
    plaintextHash: "missing-header-plaintext-hash",
  });
  await insertSpan({
    documentId: document.id,
    endCounter: 1,
    peerId: "1",
    startCounter: 0,
    updateId,
  });

  await expect(computeDocumentEditAttribution(document.id, db)).rejects.toThrow(
    `Attribution update ${updateId} has no valid writerUserId in its write header.`,
  );
});

test("returns the current attribution revision for a document with no spans", async () => {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "empty-attribution-test" })
    .returning({
      attributionIncarnation: documents.attributionIncarnation,
      id: documents.id,
    });
  if (!document) {
    throw new Error("Failed to create document");
  }

  await expect(
    computeDocumentEditAttribution(document.id, db),
  ).resolves.toEqual({
    attributionScope: "",
    attributionRevision: 0,
    documentId: document.id,
    documentIncarnation: document.attributionIncarnation,
    segments: [],
  });

  await db
    .update(documents)
    .set({ attributionRevision: 9 })
    .where(eq(documents.id, document.id));
  await expect(
    computeDocumentEditAttribution(document.id, db),
  ).resolves.toEqual({
    attributionScope: "",
    attributionRevision: 9,
    documentId: document.id,
    documentIncarnation: document.attributionIncarnation,
    segments: [],
  });
});

test("rejects attribution data from a recreated document incarnation", async () => {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "incarnation-test" })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }

  await expect(
    runPreparedDocumentEditAttributionDataWorkflow(db, {
      attributionScope: "old-incarnation:old-access-state",
      attributionRevision: 0,
      documentId: document.id,
      documentIncarnation: "old-incarnation",
    }),
  ).rejects.toThrow("Document attribution incarnation changed while loading");
});
