import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documents,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@tearleads/loro";
import { eq } from "drizzle-orm";
import {
  computeDocumentEditAttribution,
  createDocumentEditAttributionRangesPage,
  createDocumentEditAttributionResponse,
  DocumentEditAttributionIntegrityError,
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
  /** Stores the update as the one segment of a rotation baseline. */
  baseline?: boolean;
  /** When the server stored the update. */
  createdAt: string;
  /** The time the writer signed into the write header; omitted when absent. */
  signedAt?: string;
  writerUserId: string;
  writerKeyFingerprint: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const plaintextHash = `plaintext-${id}`;
  const partialStartVersionVector = input.baseline
    ? emptyVersionVector()
    : "start";
  const baselineFields = input.baseline
    ? { baselineId: crypto.randomUUID(), baselineSegmentIndex: 0 }
    : {};
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    ...baselineFields,
    dependencyVersionVector: emptyVersionVector(),
    documentId: input.documentId,
    partialEndVersionVector: input.partialEndVersionVector,
    partialStartVersionVector,
    plaintextHash,
    updateId: id,
  });
  await db.insert(documentUpdates).values({
    ...baselineFields,
    accessEpoch: 1,
    authorFingerprint: input.writerKeyFingerprint,
    byteLength: new TextEncoder().encode(input.encryptedData).byteLength,
    createdAt: new Date(input.createdAt),
    dependencyVersionVector: emptyVersionVector(),
    documentId: input.documentId,
    encryptedData: input.encryptedData,
    id,
    partialEndVersionVector: input.partialEndVersionVector,
    partialStartVersionVector,
    plaintextHash,
  });
  await db.insert(documentContentWriteHeaders).values({
    // Attribution inspects signed metadata independently of container targets.
    authorizationTargets: [],
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId: `record-${id}`,
    documentId: input.documentId,
    // Attribution reads only these three fields off the header JSON.
    header: {
      metadataHash,
      ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
      writerUserId: input.writerUserId,
      writerKeyFingerprint: input.writerKeyFingerprint,
    } as WriteHeader,
    headerHash: `header-hash-${id}`,
    nonceDomainHash: `nonce-${id}`,
    organizationId: crypto.randomUUID(),
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
    createdAt: segment.createdAt,
    signedAt: segment.signedAt,
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
    // Her device's clock ran a day ahead of the server's.
    createdAt: "2030-01-01T10:00:00.000Z",
    signedAt: "2030-01-02T10:00:00.000Z",
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
    baseline: true,
    contentKeyEpoch: 2,
    documentId,
    encryptedData: "bob-baseline-payload",
    partialEndVersionVector: late,
    createdAt: "2030-01-03T12:30:00.000Z",
    signedAt: "2030-01-03T12:29:59.500Z",
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
  // Attribution reads writerUserId off the write-header JSON; the row's
  // baseline id only flags the update as a re-assertion.

  // Earliest-span-wins: alice keeps [0,3) as a direct edit under her own key;
  // only the genuinely-new [3,10) the baseline first delivered is credited to
  // bob, flagged "baseline" (a re-assertion, not proof of authorship).
  const expected: ReturnType<typeof attributionShape> = [
    {
      authorityKind: "direct",
      // Each range carries its own upload's times: the server's receipt and
      // what the writer signed, which need not agree.
      createdAt: "2030-01-01T10:00:00.000Z",
      endCounter: 3,
      peerId: "1",
      signedAt: "2030-01-02T10:00:00.000Z",
      startCounter: 0,
      updateId: aliceUpdateId,
      writerKeyFingerprint: "fp-alice",
      writerUserId: "alice",
    },
    {
      authorityKind: "baseline",
      createdAt: "2030-01-03T12:30:00.000Z",
      endCounter: 10,
      peerId: "1",
      signedAt: "2030-01-03T12:29:59.500Z",
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
    dependencyVersionVector: emptyVersionVector(),
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

  const refusal = computeDocumentEditAttribution(document.id, db);
  await expect(refusal).rejects.toBeInstanceOf(
    DocumentEditAttributionIntegrityError,
  );
  await expect(refusal).rejects.toThrow(
    `Attribution update ${updateId} has no valid writerUserId in its write header.`,
  );
});

test("a header without a signed time fails only the ranges page, naming its update", async () => {
  const { early } = await buildVersions();
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "attribution-signed-at-test" })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }
  const updateId = await insertUpdate({
    contentKeyEpoch: 1,
    createdAt: "2030-01-01T10:00:00.000Z",
    documentId: document.id,
    encryptedData: "unsigned-time-payload",
    partialEndVersionVector: early,
    writerKeyFingerprint: "fp-alice",
    writerUserId: "alice",
  });
  await insertSpan({
    documentId: document.id,
    endCounter: 1,
    peerId: "1",
    startCounter: 0,
    updateId,
  });

  const attribution = await computeDocumentEditAttribution(document.id, db);
  expect(attribution.segments.map((segment) => segment.signedAt)).toEqual([
    null,
  ]);

  // The compact response never returns the time, so it still answers.
  expect(createDocumentEditAttributionResponse(attribution).segments).toEqual([
    {
      authorityKind: "direct",
      endCounter: 1,
      peerId: "1",
      startCounter: 0,
      writerKeyFingerprint: "fp-alice",
      writerUserId: "alice",
    },
  ]);

  let refusal: unknown;
  try {
    createDocumentEditAttributionRangesPage(attribution, {});
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(DocumentEditAttributionIntegrityError);
  expect(refusal).toMatchObject({
    message: `Attribution update ${updateId} has no valid signedAt in its write header.`,
    // The 500 handler reports an error by its name, not its message.
    name: "DocumentEditAttributionIntegrityError",
    property: "signedAt",
    updateId,
  });
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
