import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { baselineSegmentRanges } from "../../test/helpers/documentBaselineGroups";
import { insertStoredBaselineGroup } from "../../test/helpers/storedBaselineGroup";
import { resolveBaselineRedirectAfterSequence } from "./documentSyncBaselineRedirect";
import { insertDocumentUpdateSpans } from "./documentUpdateSpans";
import { listMissingDocumentUpdatePage } from "./documentUpdateStore";

/** Commits an ordinary update with its spans. */
async function commit(input: {
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly end: string;
}): Promise<{ readonly id: string; readonly sequence: number }> {
  const id = randomUUID();
  const update = {
    id,
    documentId: input.documentId,
    accessEpoch: input.contentKeyEpoch,
    authorFingerprint: "empty-baseline-test",
    encryptedData: `encrypted-${id}`,
    byteLength: 16,
    dependencyVersionVector: emptyVersionVector(),
    partialStartVersionVector: emptyVersionVector(),
    partialEndVersionVector: input.end,
    plaintextHash: `plaintext-${id}`,
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
  return { id, sequence: inserted.sequence };
}

/** Commits a one-segment baseline that reaches `end` and signs `cursor`. */
function commitBaseline(input: {
  readonly cursor: string;
  readonly documentId: string;
  readonly end: string;
}) {
  return insertStoredBaselineGroup({
    contentKeyEpoch: 2,
    coversThroughUpdateId: input.cursor,
    documentId: input.documentId,
    ranges: baselineSegmentRanges(input.end),
    withSpans: true,
  });
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
  await commitBaseline({
    cursor: overclaim.id,
    documentId,
    end: emptyVersionVector(),
  });
  const honestEnd = encodeVersionVectorCounters({ "7": 3 });
  await commit({ contentKeyEpoch: 2, documentId, end: honestEnd });
  const later = await commitBaseline({
    cursor: overclaim.id,
    documentId,
    end: honestEnd,
  });
  return { documentId, honestEnd, later, overclaim };
}

// An empty rotation baseline is one segment that declares no operations, so
// it has no span rows, and every frontier holds what it carries. Counted as
// missing, it would be served again to every pull that starts before it.
test("an empty baseline is not served to a pull that holds the rest", async () => {
  const { documentId, honestEnd, later, overclaim } =
    await allVoidThenRotated();
  const page = await listMissingDocumentUpdatePage(db, {
    afterSequence: overclaim.sequence,
    documentId,
    localVersionVector: honestEnd,
    maxSerializedBytes: 10_000,
    maxUpdates: 64,
    upperBoundSequence: later.lastSequence,
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
      upperBoundSequence: later.lastSequence,
    }),
  ).toBe(later.firstSequence - 1);
});
