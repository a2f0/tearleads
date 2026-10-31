import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
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
  // Budget: 10 statements with history retained, 13 without (14 before the
  // baseline markers moved onto the update rows), for any batch.
  for (const count of [1, 3]) {
    const ids = await insertDocuments(count);
    expect(await countPurge(ids, false)).toBe(13);
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
