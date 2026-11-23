import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { insertDocumentUpdateSpans } from "./documentUpdateSpans";
import { parseDocumentVersionFrontier } from "./documentUpdateStore";
import { hasUncommittedVersionOps } from "./documentVersionCommitted";

async function createStoredDocument(): Promise<string> {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "document-version-committed-test" })
    .returning({ id: documents.id });
  if (!document) throw new Error("Failed to create stored document");
  return document.id;
}

/** Commits an update declaring `start` to `end` on each peer. */
async function commitSpans(
  documentId: string,
  spans: Readonly<Record<string, readonly [number, number]>>,
): Promise<void> {
  const start: Record<string, number> = {};
  const end: Record<string, number> = {};
  for (const [peerId, [from, to]] of Object.entries(spans)) {
    start[peerId] = from;
    end[peerId] = to;
  }
  const update = {
    id: crypto.randomUUID(),
    partialEndVersionVector: encodeVersionVectorCounters(end),
    partialStartVersionVector: encodeVersionVectorCounters(start),
  };
  await db.insert(documentUpdates).values({
    ...update,
    accessEpoch: 1,
    authorFingerprint: "document-version-committed-author",
    byteLength: 1,
    documentId,
    encryptedData: `encrypted-${update.id}`,
    plaintextHash: `plaintext-${update.id}`,
  });
  await insertDocumentUpdateSpans(db, { documentId, updates: [update] });
}

function uncommitted(
  documentId: string,
  counters: Readonly<Record<string, number>>,
): Promise<boolean> {
  return hasUncommittedVersionOps(db, {
    documentId,
    version: parseDocumentVersionFrontier(
      encodeVersionVectorCounters(counters),
    ),
  });
}

test("a version is committed while every peer's counter is within a committed span", async () => {
  const documentId = await createStoredDocument();
  expect(await uncommitted(documentId, {})).toBe(false);
  expect(await uncommitted(documentId, { "11": 1 })).toBe(true);

  await commitSpans(documentId, { "11": [0, 3] });
  await commitSpans(documentId, { "11": [3, 5], "22": [0, 2] });
  // Any counter up to the furthest committed end, over any of the updates.
  expect(await uncommitted(documentId, { "11": 5, "22": 2 })).toBe(false);
  expect(await uncommitted(documentId, { "11": 2 })).toBe(false);
  // One op past a peer's committed end, or a peer never committed.
  expect(await uncommitted(documentId, { "11": 6 })).toBe(true);
  expect(await uncommitted(documentId, { "11": 5, "22": 3 })).toBe(true);
  expect(await uncommitted(documentId, { "11": 1, "33": 1 })).toBe(true);
});

test("another document's spans never commit a version", async () => {
  const documentId = await createStoredDocument();
  const otherDocumentId = await createStoredDocument();
  await commitSpans(otherDocumentId, { "11": [0, 4] });

  expect(await uncommitted(documentId, { "11": 1 })).toBe(true);
  expect(await uncommitted(otherDocumentId, { "11": 4 })).toBe(false);
});
