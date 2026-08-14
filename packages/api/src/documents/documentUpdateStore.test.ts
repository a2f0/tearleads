import { expect, test } from "bun:test";
import { type DatabaseSession, db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { insertDocumentUpdateSpans } from "./documentUpdateSpans";
import {
  assertMinLsnSatisfied,
  DocumentUpdateReadError,
  listMissingDocumentUpdates,
} from "./documentUpdateStore";

const textEncoder = new TextEncoder();

async function createStoredDocument(): Promise<string> {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "document-update-store-test" })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create stored document");
  }
  return document.id;
}

async function insertStoredUpdate(input: {
  documentId: string;
  encryptedData: string;
  id: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
}) {
  await db.insert(documentUpdates).values({
    id: input.id,
    documentId: input.documentId,
    accessEpoch: 1,
    authorFingerprint: "document-update-store-author",
    encryptedData: input.encryptedData,
    byteLength: textEncoder.encode(input.encryptedData).byteLength,
    partialStartVersionVector: input.partialStartVersionVector,
    partialEndVersionVector: input.partialEndVersionVector,
    plaintextHash: `plaintext-${input.id}`,
  });
  await insertDocumentUpdateSpans(db, {
    documentId: input.documentId,
    updates: [input],
  });
}

async function expectDocumentUpdateReadError(
  promise: Promise<unknown>,
): Promise<DocumentUpdateReadError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentUpdateReadError);
    return error as DocumentUpdateReadError;
  }

  throw new Error("Expected document update read operation to fail");
}

test("listMissingDocumentUpdates returns only causally missing document updates", async () => {
  const documentId = await createStoredDocument();
  const aliceDoc = await createDocument("document-update-store-alice");
  const aliceStartVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("Hello from Alice");
  const firstUpdate = exportUpdatesSince(aliceDoc, aliceStartVersion);
  const firstVectors = getUpdateVersionVectors(firstUpdate);
  const bobDoc = await createDocument("document-update-store-bob");
  importUpdates(bobDoc, [firstUpdate]);
  const bobStartVersion = encodeVersionVector(bobDoc);
  bobDoc.getText("text").update("Hello from Alice and Bob");
  const secondUpdate = exportUpdatesSince(bobDoc, bobStartVersion);
  const secondVectors = getUpdateVersionVectors(secondUpdate);

  const firstUpdateId = crypto.randomUUID();
  const secondUpdateId = crypto.randomUUID();
  await insertStoredUpdate({
    documentId,
    encryptedData: "encrypted-first-update-with-checkmark-✓",
    id: firstUpdateId,
    partialStartVersionVector: firstVectors.partialStartVersionVector,
    partialEndVersionVector: firstVectors.partialEndVersionVector,
  });
  await insertStoredUpdate({
    documentId,
    encryptedData: "encrypted-second-update",
    id: secondUpdateId,
    partialStartVersionVector: secondVectors.partialStartVersionVector,
    partialEndVersionVector: secondVectors.partialEndVersionVector,
  });

  const allMissing = await listMissingDocumentUpdates(db, {
    documentId,
    localVersionVector: null,
  });
  expect(allMissing.map((update) => update.id)).toEqual([
    firstUpdateId,
    secondUpdateId,
  ]);
  expect(allMissing[0]?.byteLength).toBe(
    textEncoder.encode("encrypted-first-update-with-checkmark-✓").byteLength,
  );

  const missingAfterFirstUpdate = await listMissingDocumentUpdates(db, {
    documentId,
    localVersionVector: encodeVersionVector(aliceDoc),
  });
  expect(missingAfterFirstUpdate.map((update) => update.id)).toEqual([
    secondUpdateId,
  ]);

  const missingAfterSecondUpdate = await listMissingDocumentUpdates(db, {
    documentId,
    localVersionVector: encodeVersionVector(bobDoc),
  });
  expect(missingAfterSecondUpdate).toEqual([]);
});

test("listMissingDocumentUpdates rejects unsatisfied minLsn reads", async () => {
  const documentId = await createStoredDocument();

  const error = await expectDocumentUpdateReadError(
    listMissingDocumentUpdates(db, {
      documentId,
      localVersionVector: null,
      minLsn: "FFFFFFFF/FFFFFFFF",
    }),
  );
  expect(error.status).toBe(503);
  expect(error.message).toBe(
    "Requested minimum commit LSN has not been reached",
  );
});

test("Turso minLsn checks bypass replica watermark queries", async () => {
  const executor = {
    execute: () => {
      throw new Error("Turso minLsn check must not execute a query");
    },
  } as unknown as DatabaseSession;

  await expect(
    assertMinLsnSatisfied(executor, "FFFFFFFF/FFFFFFFF", "turso"),
  ).resolves.toBeUndefined();
});

test("listMissingDocumentUpdates rejects malformed local version vectors", async () => {
  const documentId = await createStoredDocument();

  const error = await expectDocumentUpdateReadError(
    listMissingDocumentUpdates(db, {
      documentId,
      localVersionVector: "not-base64",
    }),
  );
  expect(error.status).toBe(400);
  expect(error.message).toBe("Invalid local version vector");
});
