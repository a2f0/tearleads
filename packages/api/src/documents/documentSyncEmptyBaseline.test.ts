import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  computeDocumentContentRecordMetadataHash,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { resolveBaselineRedirectAfterSequence } from "./documentSyncBaselineRedirect";
import { insertDocumentUpdateSpans } from "./documentUpdateSpans";
import { listMissingDocumentUpdatePage } from "./documentUpdateStore";

/** Commits an update with its spans; a baseline also gets its header. */
async function commit(input: {
  readonly baselineCursor?: string;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly end: string;
}): Promise<{ readonly id: string; readonly sequence: number }> {
  const id = randomUUID();
  const start = emptyVersionVector();
  const plaintextHash = `plaintext-${id}`;
  const baseline = input.baselineCursor !== undefined;
  const update = {
    id,
    documentId: input.documentId,
    accessEpoch: input.contentKeyEpoch,
    authorFingerprint: "empty-baseline-test",
    encryptedData: `encrypted-${id}`,
    byteLength: 16,
    partialStartVersionVector: start,
    partialEndVersionVector: input.end,
    plaintextHash,
    baselineSourceVersionVector: baseline ? input.end : null,
    baselineCoversThroughUpdateId: input.baselineCursor ?? null,
  };
  const [inserted] = await db
    .insert(documentUpdates)
    .values(update)
    .returning({ sequence: documentUpdates.sequence });
  if (!inserted) throw new Error("Failed to insert the update");
  await insertDocumentUpdateSpans(db, {
    documentId: input.documentId,
    updates: [update],
  });
  if (baseline) {
    const metadataHash = await computeDocumentContentRecordMetadataHash({
      checkpointKind: "rotate_baseline",
      checkpointPayloadKind: "full_history_snapshot",
      coversThroughUpdateId: input.baselineCursor,
      documentId: input.documentId,
      partialEndVersionVector: input.end,
      partialStartVersionVector: start,
      plaintextHash,
      sourceVersionVector: input.end,
      updateId: id,
    });
    await db.insert(documentContentWriteHeaders).values({
      // This fixture tests baseline coverage, not write authorization.
      authorizationTargets: [],
      updateId: id,
      documentId: input.documentId,
      organizationId: randomUUID(),
      contentKeyEpoch: input.contentKeyEpoch,
      contentRecordId: id,
      nonceDomainHash: `nonce-${id}`,
      headerHash: `header-${id}`,
      header: { metadataHash } as unknown as WriteHeader,
    });
  }
  return { id, sequence: inserted.sequence };
}

/**
 * An overclaim, an empty baseline signing it, an honest update, and a later
 * baseline whose cursor precedes the empty one.
 */
async function allVoidThenRotated() {
  const documentId = randomUUID();
  const overclaim = await commit({
    contentKeyEpoch: 1,
    documentId,
    end: encodeVersionVectorCounters({ "4242": 7 }),
  });
  await commit({
    baselineCursor: overclaim.id,
    contentKeyEpoch: 2,
    documentId,
    end: emptyVersionVector(),
  });
  const honestEnd = encodeVersionVectorCounters({ "7": 3 });
  await commit({ contentKeyEpoch: 2, documentId, end: honestEnd });
  const later = await commit({
    baselineCursor: overclaim.id,
    contentKeyEpoch: 2,
    documentId,
    end: honestEnd,
  });
  return { documentId, honestEnd, later, overclaim };
}

// An empty rotation baseline declares no operations, so it has no span rows,
// and every frontier holds what it carries. Counted as missing, it would be
// served again to every pull that starts before it.
test("an empty baseline is not served to a pull that holds the rest", async () => {
  const { documentId, honestEnd, later, overclaim } =
    await allVoidThenRotated();
  const page = await listMissingDocumentUpdatePage(db, {
    afterSequence: overclaim.sequence,
    documentId,
    localVersionVector: honestEnd,
    maxSerializedBytes: 10_000,
    maxUpdates: 64,
    upperBoundSequence: later.sequence,
  });
  expect(page.updates).toEqual([]);
});

// Counted as missing, the empty baseline would also keep a later baseline
// whose cursor precedes it from starting a new reader, who would then be
// served the overclaim it cannot decrypt.
test("a later baseline redirects a new reader past an empty one", async () => {
  const { documentId, later } = await allVoidThenRotated();
  expect(
    await resolveBaselineRedirectAfterSequence({
      afterSequence: 0,
      contentKeyEpoch: 2,
      documentId,
      executor: db,
      firstPage: true,
      localVersionVector: null,
      upperBoundSequence: later.sequence,
    }),
  ).toBe(later.sequence - 1);
});
