import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { documents } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import { runPrepareDocumentEditAttributionWorkflow } from "./documentEditAttribution";

test("does not combine authorization from a purged incarnation with its replacement", async () => {
  const documentId = crypto.randomUUID();
  const originalIncarnation = crypto.randomUUID();
  const replacementIncarnation = crypto.randomUUID();
  await db.insert(documents).values({
    attributionIncarnation: originalIncarnation,
    createdByFingerprint: "original-document",
    id: documentId,
  });

  let authorizationCalls = 0;
  const preparation = runPrepareDocumentEditAttributionWorkflow(
    db,
    { documentId, userId: crypto.randomUUID() },
    async (executor) => {
      authorizationCalls += 1;
      await executor.delete(documents).where(eq(documents.id, documentId));
      await executor.insert(documents).values({
        attributionIncarnation: replacementIncarnation,
        attributionRevision: 17,
        createdByFingerprint: "replacement-document",
        id: documentId,
      });
      return "access-state-authorized-for-original";
    },
  );

  await expect(preparation).rejects.toMatchObject({
    message: "Document attribution incarnation changed while authorizing",
    status: 409,
  });
  expect(authorizationCalls).toBe(1);

  const [replacement] = await db
    .select({
      attributionIncarnation: documents.attributionIncarnation,
      attributionRevision: documents.attributionRevision,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  expect(replacement).toEqual({
    attributionIncarnation: replacementIncarnation,
    attributionRevision: 17,
  });
});
