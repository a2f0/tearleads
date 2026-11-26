import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegmentSpans,
  documentBaselineSegments,
  documentBaselineStages,
  documentPeerOwners,
  documents,
  documentUpdateSpans,
} from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";
import { DocumentMutationError } from "./errors";
import { deleteDocumentRows } from "./purgeDocumentRows";

async function insertDocuments(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  await db
    .insert(documents)
    .values(
      ids.map((id) => ({ id, createdByFingerprint: "purge-budget-test" })),
    );
  return ids;
}

async function countPurge(
  documentIds: readonly string[],
  retainAccessHistory: boolean,
): Promise<number> {
  const counter = { statements: 0 };
  // Counted inside the transaction, so transaction controls are excluded.
  await db.transaction((executor) =>
    withDatabaseStatementCounter(counter, () =>
      deleteDocumentRows({
        documentIds,
        executor,
        orphanedBlobIds: [],
        retainAccessHistory,
      }),
    ),
  );
  return counter.statements;
}

test("deleting documents costs the same statements for one or many", async () => {
  // Budget: 13 statements with history retained, 17 without (10 and 14 before
  // rotation baseline stages, their staged segments and those segments' spans
  // were deleted with the document, 9 and 13 before peer owners were deleted
  // with the spans), for any batch.
  for (const count of [1, 3]) {
    const ids = await insertDocuments(count);
    expect(await countPurge(ids, false)).toBe(17);
    expect(
      await db.select().from(documents).where(inArray(documents.id, ids)),
    ).toEqual([]);
    expect(await countPurge(await insertDocuments(count), true)).toBe(13);
  }
});

test("a missing document fails the whole batch with 404", async () => {
  const [present] = await insertDocuments(1);
  if (!present) throw new Error("Missing fixture document");
  await expect(
    countPurge([present, crypto.randomUUID()], false),
  ).rejects.toBeInstanceOf(DocumentMutationError);
  await expect(
    countPurge([present, crypto.randomUUID()], false),
  ).rejects.toMatchObject({ status: 404 });
  // The transaction rolled back, so the present document survives.
  expect(
    await db
      .select()
      .from(documents)
      .where(inArray(documents.id, [present])),
  ).toHaveLength(1);
});

// A document's open stage, what it staged, and the staged rows that hold a
// committed baseline's payloads all go with the document, and no other
// document's do.
test("a purge deletes the documents' baseline stages and staged segments", async () => {
  const ids = await insertDocuments(2);
  const [purged, kept] = ids;
  if (!purged || !kept) throw new Error("Missing fixture documents");
  for (const documentId of ids) {
    const baselineId = crypto.randomUUID();
    const updateId = crypto.randomUUID();
    await db.insert(documentBaselineStages).values({
      contentKeyCommitment: "c".repeat(64),
      contentKeyEpoch: 1,
      documentId,
      expiresAt: new Date(Date.now() + 60_000),
      id: baselineId,
      organizationId: crypto.randomUUID(),
      ownerUserId: crypto.randomUUID(),
      segmentsDigest: "0".repeat(64),
    });
    await db.insert(documentBaselineSegments).values({
      authorizationHash: "authorization",
      baselineId,
      byteLength: 7,
      contentRecordId: updateId,
      dependencyVersionVector: "dependency",
      documentId,
      encryptedData: "payload",
      header: {} as (typeof documentBaselineSegments.$inferInsert)["header"],
      headerHash: `header-${updateId}`,
      nonceDomainHash: `nonce-${updateId}`,
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      plaintextHash: "plaintext",
      segmentIndex: 0,
      updateId,
    });
    await db.insert(documentBaselineSegmentSpans).values({
      baselineId,
      documentId,
      endCounter: 3,
      peerId: "4242",
      startCounter: 0,
      updateId,
    });
  }

  await countPurge([purged], false);

  for (const table of [
    documentBaselineStages,
    documentBaselineSegments,
    documentBaselineSegmentSpans,
  ]) {
    expect(
      await db
        .select({ documentId: table.documentId })
        .from(table)
        .where(inArray(table.documentId, ids)),
    ).toEqual([{ documentId: kept }]);
  }
});

test("a purge deletes the documents' peer owners with their spans", async () => {
  const ids = await insertDocuments(2);
  const [purged, kept] = ids;
  if (!purged || !kept) throw new Error("Missing fixture documents");
  for (const documentId of ids) {
    await db.insert(documentUpdateSpans).values({
      documentId,
      endCounter: 3,
      peerId: "4242",
      startCounter: 0,
      updateId: crypto.randomUUID(),
    });
    await db.insert(documentPeerOwners).values({
      documentId,
      ownerUserId: crypto.randomUUID(),
      peerId: "4242",
    });
  }

  await countPurge([purged], false);

  const owners = await db
    .select({ documentId: documentPeerOwners.documentId })
    .from(documentPeerOwners)
    .where(inArray(documentPeerOwners.documentId, ids));
  expect(owners).toEqual([{ documentId: kept }]);
});
