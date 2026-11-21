import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
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
  hasDocumentOpsBeyondVersion,
  parseDocumentVersionFrontier,
} from "./documentUpdateStore";

type LoroDoc = Awaited<ReturnType<typeof createDocument>>;

async function createStoredDocument(): Promise<string> {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "document-ops-beyond-version-test" })
    .returning({ id: documents.id });
  if (!document) throw new Error("Failed to create stored document");
  return document.id;
}

/** Edits `doc` and commits the edit's update; `spans: false` stores none. */
async function commitEdit(
  documentId: string,
  doc: LoroDoc,
  text: string,
  spans = true,
): Promise<Uint8Array> {
  const start = encodeVersionVector(doc);
  doc.getText("text").update(text);
  const bytes = exportUpdatesSince(doc, start);
  const vectors = getUpdateVersionVectors(bytes);
  const update = {
    id: crypto.randomUUID(),
    partialEndVersionVector: vectors.partialEndVersionVector,
    partialStartVersionVector: vectors.partialStartVersionVector,
  };
  await db.insert(documentUpdates).values({
    ...update,
    accessEpoch: 1,
    authorFingerprint: "document-ops-beyond-version-author",
    byteLength: bytes.byteLength,
    documentId,
    encryptedData: `encrypted-${update.id}`,
    plaintextHash: `plaintext-${update.id}`,
  });
  if (spans) {
    await insertDocumentUpdateSpans(db, { documentId, updates: [update] });
  }
  return bytes;
}

function beyond(documentId: string, doc: LoroDoc): Promise<boolean> {
  return hasDocumentOpsBeyondVersion(db, {
    documentId,
    version: parseDocumentVersionFrontier(encodeVersionVector(doc)),
  });
}

test("a peer that advances past the version is beyond it", async () => {
  const documentId = await createStoredDocument();
  const alice = await createDocument("ops-beyond-alice");
  const checked = await createDocument("ops-beyond-checked");
  importUpdates(checked, [await commitEdit(documentId, alice, "first")]);
  expect(await beyond(documentId, checked)).toBe(false);

  // The same peer's next update extends its counter past the version.
  await commitEdit(documentId, alice, "first and second");
  expect(await beyond(documentId, checked)).toBe(true);
  expect(await beyond(documentId, alice)).toBe(false);
});

test("a version that covers one peer but lags another is beyond it", async () => {
  const documentId = await createStoredDocument();
  const alice = await createDocument("ops-lagging-alice");
  const bob = await createDocument("ops-lagging-bob");
  const aliceUpdate = await commitEdit(documentId, alice, "from alice");
  const bobUpdate = await commitEdit(documentId, bob, "from bob");

  expect(await beyond(documentId, alice)).toBe(true);
  expect(await beyond(documentId, bob)).toBe(true);
  const merged = await createDocument("ops-lagging-merged");
  importUpdates(merged, [aliceUpdate, bobUpdate]);
  expect(await beyond(documentId, merged)).toBe(false);
});

test("an update with no span is ignored", async () => {
  const documentId = await createStoredDocument();
  const alice = await createDocument("ops-spanless-alice");
  await commitEdit(documentId, alice, "spanless", false);

  const empty = await createDocument("ops-spanless-empty");
  expect(await beyond(documentId, empty)).toBe(false);
});
