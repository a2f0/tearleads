import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
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
  listMissingDocumentUpdatePage,
  listMissingDocumentUpdates,
  readDocumentUpdateSequenceUpperBound,
  readDocumentUpdateUpperBound,
  resolveDocumentUpdateCursorBounds,
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
  authorFingerprint?: string | undefined;
  documentId: string;
  encryptedData: string;
  id: string;
  insertSpans?: boolean | undefined;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
}) {
  await db.insert(documentUpdates).values({
    id: input.id,
    documentId: input.documentId,
    accessEpoch: 1,
    authorFingerprint:
      input.authorFingerprint ?? "document-update-store-author",
    encryptedData: input.encryptedData,
    byteLength: textEncoder.encode(input.encryptedData).byteLength,
    partialStartVersionVector: input.partialStartVersionVector,
    partialEndVersionVector: input.partialEndVersionVector,
    plaintextHash: `plaintext-${input.id}`,
  });
  if (input.insertSpans !== false) {
    await insertDocumentUpdateSpans(db, {
      documentId: input.documentId,
      updates: [input],
    });
  }
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

test("document update pages retain their upper bound across concurrent writes", async () => {
  const documentId = await createStoredDocument();
  const loro = await createDocument("document-update-page-author");

  const firstStart = encodeVersionVector(loro);
  loro.getText("text").update("first");
  const first = getUpdateVersionVectors(exportUpdatesSince(loro, firstStart));
  const firstId = crypto.randomUUID();
  await insertStoredUpdate({
    documentId,
    encryptedData: "encrypted-first",
    id: firstId,
    partialEndVersionVector: first.partialEndVersionVector,
    partialStartVersionVector: first.partialStartVersionVector,
  });

  const secondStart = encodeVersionVector(loro);
  loro.getText("text").update("second");
  const second = getUpdateVersionVectors(exportUpdatesSince(loro, secondStart));
  const secondId = crypto.randomUUID();
  await insertStoredUpdate({
    documentId,
    encryptedData: "encrypted-second",
    id: secondId,
    partialEndVersionVector: second.partialEndVersionVector,
    partialStartVersionVector: second.partialStartVersionVector,
  });

  const upperBoundSequence = await readDocumentUpdateSequenceUpperBound(
    db,
    documentId,
  );
  expect(await readDocumentUpdateUpperBound(db, documentId)).toEqual({
    id: secondId,
    sequence: upperBoundSequence,
  });
  const firstPage = await listMissingDocumentUpdatePage(db, {
    afterSequence: 0,
    documentId,
    localVersionVector: null,
    maxSerializedBytes: 1_000,
    maxUpdates: 1,
    upperBoundSequence,
  });
  expect(firstPage.updates.map(({ id }) => id)).toEqual([firstId]);
  expect(firstPage.hasMore).toBe(true);

  const thirdStart = encodeVersionVector(loro);
  loro.getText("text").update("third");
  const third = getUpdateVersionVectors(exportUpdatesSince(loro, thirdStart));
  const thirdId = crypto.randomUUID();
  await insertStoredUpdate({
    documentId,
    encryptedData: "encrypted-third",
    id: thirdId,
    partialEndVersionVector: third.partialEndVersionVector,
    partialStartVersionVector: third.partialStartVersionVector,
  });

  const secondPage = await listMissingDocumentUpdatePage(db, {
    afterSequence: firstPage.lastSequence,
    documentId,
    localVersionVector: null,
    maxSerializedBytes: 1_000,
    maxUpdates: 1,
    upperBoundSequence,
  });
  expect(secondPage.updates.map(({ id }) => id)).toEqual([secondId]);
  expect(secondPage.hasMore).toBe(false);
  expect(
    await resolveDocumentUpdateCursorBounds(db, {
      afterUpdateId: firstId,
      documentId,
      upperBoundUpdateId: secondId,
    }),
  ).toEqual({
    afterSequence: firstPage.lastSequence,
    upperBoundSequence,
  });

  const foreignDocumentId = await createStoredDocument();
  const foreignCursorError = await expectDocumentUpdateReadError(
    resolveDocumentUpdateCursorBounds(db, {
      afterUpdateId: firstId,
      documentId: foreignDocumentId,
      upperBoundUpdateId: secondId,
    }),
  );
  expect(foreignCursorError.status).toBe(400);

  const freshUpperBound = await readDocumentUpdateSequenceUpperBound(
    db,
    documentId,
  );
  const freshPage = await listMissingDocumentUpdatePage(db, {
    afterSequence: secondPage.lastSequence,
    documentId,
    localVersionVector: null,
    maxSerializedBytes: 1_000,
    maxUpdates: 1,
    upperBoundSequence: freshUpperBound,
  });
  expect(freshPage.updates.map(({ id }) => id)).toEqual([thirdId]);
});

test("document update pages budget serialized metadata, not only ciphertext", async () => {
  const documentId = await createStoredDocument();
  const updateIds = Array.from({ length: 3 }, () => crypto.randomUUID());
  for (const id of updateIds) {
    await insertStoredUpdate({
      authorFingerprint: `metadata-heavy-${"a".repeat(2_048)}`,
      documentId,
      encryptedData: "x",
      id,
      insertSpans: false,
      partialEndVersionVector: `end-${"b".repeat(2_048)}`,
      partialStartVersionVector: `start-${"c".repeat(2_048)}`,
    });
  }

  const stored = await listMissingDocumentUpdates(db, {
    documentId,
    localVersionVector: null,
  });
  const first = stored[0];
  if (!first) throw new Error("Expected a stored update");
  const oneUpdateBytes = Buffer.byteLength(JSON.stringify(first), "utf8") + 2;
  const upperBoundSequence = await readDocumentUpdateSequenceUpperBound(
    db,
    documentId,
  );
  const page = await listMissingDocumentUpdatePage(db, {
    afterSequence: 0,
    documentId,
    localVersionVector: null,
    maxSerializedBytes: oneUpdateBytes,
    maxUpdates: 64,
    upperBoundSequence,
  });

  expect(page.updates.map(({ id }) => id)).toEqual(updateIds.slice(0, 1));
  expect(page.hasMore).toBe(true);
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
