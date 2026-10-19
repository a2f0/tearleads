import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentBaselines,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  listDocumentUpdateResponseByteFloors,
  prefixWithinResponseByteFloors,
} from "./documentUpdateByteFloors";

const bytes = (value: string) => Buffer.byteLength(value, "utf8");

test("response byte floors count the UTF-8 bytes of every variable-size string", async () => {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "byte-floor-test" })
    .returning({ id: documents.id });
  if (!document) throw new Error("Failed to create stored document");
  // Multibyte text tells bytes apart from characters on every dialect.
  const ordinary = {
    authorFingerprint: "author-✓",
    encryptedData: "cipher-✓✓",
    id: crypto.randomUUID(),
    partialEndVersionVector: "end-✓",
    partialStartVersionVector: "start-✓",
    plaintextHash: "hash-✓",
  };
  const checkpoint = { ...ordinary, id: crypto.randomUUID() };
  const sourceVersionVector = "source-✓✓✓";
  for (const update of [ordinary, checkpoint]) {
    await db.insert(documentUpdates).values({
      ...update,
      accessEpoch: 1,
      byteLength: bytes(update.encryptedData),
      documentId: document.id,
    });
  }
  await db.insert(documentBaselines).values({
    baselineUpdateId: checkpoint.id,
    checkpointKind: "rotate_baseline",
    documentId: document.id,
    sourceVersionVector,
  });

  const ordinaryBytes =
    bytes(ordinary.authorFingerprint) +
    bytes(ordinary.encryptedData) +
    bytes(ordinary.partialEndVersionVector) +
    bytes(ordinary.partialStartVersionVector) +
    bytes(ordinary.plaintextHash);
  expect(
    await listDocumentUpdateResponseByteFloors(db, [
      ordinary.id,
      checkpoint.id,
    ]),
  ).toEqual(
    new Map([
      [ordinary.id, ordinaryBytes],
      [checkpoint.id, ordinaryBytes + bytes(sourceVersionVector)],
    ]),
  );
});

test("a floor prefix stops at the first overflow and always keeps the first", () => {
  const candidates = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const floors = new Map([
    ["a", 10],
    ["b", 10],
    ["c", 10],
  ]);
  // Brackets, two floors, and the comma between them.
  expect(prefixWithinResponseByteFloors(candidates, floors, 23)).toEqual([
    { id: "a" },
    { id: "b" },
  ]);
  expect(prefixWithinResponseByteFloors(candidates, floors, 22)).toEqual([
    { id: "a" },
  ]);
  expect(prefixWithinResponseByteFloors(candidates, floors, 1)).toEqual([
    { id: "a" },
  ]);
  expect(prefixWithinResponseByteFloors([], floors, 1)).toEqual([]);
});

test("a candidate without a floor reports the page as changed", () => {
  expect(
    prefixWithinResponseByteFloors(
      [{ id: "a" }, { id: "gone" }],
      new Map([["a", 1]]),
      1_000,
    ),
  ).toBeUndefined();
});
