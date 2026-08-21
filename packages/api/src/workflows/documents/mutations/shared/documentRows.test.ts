import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { documents } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import { touchDocumentAndLinkedContainers } from "./documentRows";

async function readAttributionRevision(documentId: string): Promise<number> {
  const [document] = await db
    .select({ attributionRevision: documents.attributionRevision })
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!document) {
    throw new Error("Document was not found");
  }
  return document.attributionRevision;
}

test("touching an accepted sync atomically advances attribution revision", async () => {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "revision-increment-test" })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }

  await db.transaction(async (tx) => {
    await touchDocumentAndLinkedContainers(tx, {
      documentId: document.id,
      incrementAttributionRevision: true,
      linkedContainerIds: [],
    });
    await touchDocumentAndLinkedContainers(tx, {
      documentId: document.id,
      incrementAttributionRevision: true,
      linkedContainerIds: [],
    });
  });

  expect(await readAttributionRevision(document.id)).toBe(2);
});

test("ordinary metadata touches leave attribution revision unchanged", async () => {
  const [document] = await db
    .insert(documents)
    .values({
      attributionRevision: 5,
      createdByFingerprint: "revision-stability-test",
    })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }

  await db.transaction((tx) =>
    touchDocumentAndLinkedContainers(tx, {
      documentId: document.id,
      linkedContainerIds: [],
    }),
  );

  expect(await readAttributionRevision(document.id)).toBe(5);
});
