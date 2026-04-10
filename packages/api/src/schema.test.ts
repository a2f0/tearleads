import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "./adapters/postgres";
import { documentUpdateSpans } from "./schema";

test("document_update_spans stores visible causal index rows", async () => {
  const documentId = crypto.randomUUID();
  const updateId = crypto.randomUUID();

  await db.insert(documentUpdateSpans).values([
    {
      documentId,
      updateId,
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
    },
    {
      documentId,
      updateId,
      peerId: "2",
      startCounter: 4,
      endCounter: 9,
    },
  ]);

  const spans = await db
    .select({
      endCounter: documentUpdateSpans.endCounter,
      peerId: documentUpdateSpans.peerId,
      startCounter: documentUpdateSpans.startCounter,
    })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.updateId, updateId))
    .orderBy(documentUpdateSpans.peerId);

  expect(spans).toEqual([
    {
      endCounter: 3,
      peerId: "1",
      startCounter: 0,
    },
    {
      endCounter: 9,
      peerId: "2",
      startCounter: 4,
    },
  ]);
});
