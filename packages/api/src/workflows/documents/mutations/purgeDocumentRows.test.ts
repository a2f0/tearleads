import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
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
  // Budget: 10 statements with history retained, 14 without (10 and 14 before
  // the baseline markers moved onto the update rows, 9 and 13 before peer
  // owners were deleted with the spans), for any batch.
  for (const count of [1, 3]) {
    const ids = await insertDocuments(count);
    expect(await countPurge(ids, false)).toBe(14);
    expect(
      await db.select().from(documents).where(inArray(documents.id, ids)),
    ).toEqual([]);
    expect(await countPurge(await insertDocuments(count), true)).toBe(10);
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
