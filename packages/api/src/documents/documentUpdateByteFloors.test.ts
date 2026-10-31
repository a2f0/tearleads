import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type DocumentContentKeyTarget,
  type WriteHeader,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  listDocumentUpdateResponseByteFloors,
  prefixWithinResponseByteFloors,
} from "./documentUpdateByteFloors";
import {
  listMissingDocumentUpdatePage,
  readDocumentUpdateSequenceUpperBound,
} from "./documentUpdateStore";

const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const jsonBytes = (value: unknown) => bytes(JSON.stringify(value));

interface StoredUpdate {
  readonly authorFingerprint: string;
  readonly encryptedData: string;
  readonly id: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly plaintextHash: string;
}

function storedUpdate(overrides: Partial<StoredUpdate> = {}): StoredUpdate {
  return {
    authorFingerprint: "author",
    encryptedData: "x",
    id: crypto.randomUUID(),
    partialEndVersionVector: "end",
    partialStartVersionVector: "start",
    plaintextHash: "hash",
    ...overrides,
  };
}

async function storeDocument(updates: readonly StoredUpdate[]) {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "byte-floor-test" })
    .returning({ id: documents.id });
  if (!document) throw new Error("Failed to create stored document");
  for (const update of updates) {
    await db.insert(documentUpdates).values({
      ...update,
      accessEpoch: 1,
      byteLength: bytes(update.encryptedData),
      documentId: document.id,
    });
  }
  return document.id;
}

async function storeWriteHeader(input: {
  readonly authorizationTargets: readonly unknown[];
  readonly documentId: string;
  readonly header: Record<string, unknown>;
  readonly updateId: string;
}) {
  // Only the stored JSON's size matters here, not its validity.
  await db.insert(documentContentWriteHeaders).values({
    accessManifestHash: "manifest",
    authorizationTargets:
      input.authorizationTargets as DocumentContentKeyTarget[],
    contentKeyEpoch: 1,
    contentRecordId: input.updateId,
    documentId: input.documentId,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    header: input.header as unknown as WriteHeader,
    headerHash: `header-${input.updateId}`,
    nonceDomainHash: `nonce-${input.updateId}`,
    organizationId: crypto.randomUUID(),
    targetHash: "targets",
    updateId: input.updateId,
  });
}

async function storeCheckpoint(input: {
  readonly documentId: string;
  readonly sourceVersionVector: string;
  readonly updateId: string;
}) {
  await db
    .update(documentUpdates)
    .set({ baselineSourceVersionVector: input.sourceVersionVector })
    .where(eq(documentUpdates.id, input.updateId));
}

test("response byte floors count the UTF-8 bytes of every variable-size part", async () => {
  // Multibyte text tells bytes apart from characters on every dialect.
  const ordinary = storedUpdate({
    authorFingerprint: "author-✓",
    encryptedData: "cipher-✓✓",
    partialEndVersionVector: "end-✓",
    partialStartVersionVector: "start-✓",
    plaintextHash: "hash-✓",
  });
  const checkpoint = { ...ordinary, id: crypto.randomUUID() };
  const documentId = await storeDocument([ordinary, checkpoint]);
  const sourceVersionVector = "source-✓✓✓";
  await storeCheckpoint({
    documentId,
    sourceVersionVector,
    updateId: checkpoint.id,
  });
  const header = { signature: "sig-✓", version: 1, writerDeviceId: "device-✓" };
  const authorizationTargets = [{ containerId: "container-✓", epoch: 2 }];
  await storeWriteHeader({
    authorizationTargets,
    documentId,
    header,
    updateId: ordinary.id,
  });

  const stringBytes =
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
      [
        ordinary.id,
        stringBytes + jsonBytes(header) + jsonBytes(authorizationTargets),
      ],
      [checkpoint.id, stringBytes + bytes(sourceVersionVector)],
    ]),
  );
});

const largeParts = {
  "checkpoint source version vector": (documentId: string, id: string) =>
    storeCheckpoint({
      documentId,
      sourceVersionVector: "s".repeat(4_096),
      updateId: id,
    }),
  "write header": (documentId: string, id: string) =>
    storeWriteHeader({
      authorizationTargets: [],
      documentId,
      header: { writerDeviceId: "d".repeat(4_096) },
      updateId: id,
    }),
  "authorization target list": (documentId: string, id: string) =>
    storeWriteHeader({
      authorizationTargets: [{ containerId: "c".repeat(4_096) }],
      documentId,
      header: {},
      updateId: id,
    }),
};

for (const [part, store] of Object.entries(largeParts)) {
  test(`a page loads no update past an oversized ${part}`, async () => {
    const first = storedUpdate();
    const second = storedUpdate();
    const documentId = await storeDocument([first, second]);
    await store(documentId, second.id);
    // A checkpoint's vector rides on its update row; measure the rows
    // without it, as the other parts live outside the row.
    const rowsBytes = (
      await db
        .select()
        .from(documentUpdates)
        .where(eq(documentUpdates.documentId, documentId))
    ).reduce(
      (sum, row) =>
        sum + jsonBytes({ ...row, baselineSourceVersionVector: null }),
      3,
    );

    // Both rows fit the ceiling, but a response entry for the second carries
    // the large part too, so the page never loads that row.
    const page = await listMissingDocumentUpdatePage(db, {
      afterSequence: 0,
      documentId,
      localVersionVector: null,
      maxSerializedBytes: rowsBytes,
      maxUpdates: 64,
      upperBoundSequence: await readDocumentUpdateSequenceUpperBound(
        db,
        documentId,
      ),
    });
    expect(page.updates.map(({ id }) => id)).toEqual([first.id]);
    expect(page.hasMore).toBe(true);
  });
}

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
